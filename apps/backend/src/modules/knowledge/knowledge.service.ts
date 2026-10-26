import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KbDocument } from './entities/kb-document.entity';
import { RagClient } from './rag-client';
import { Document } from '../documents/entities/document.entity';
import { PermissionCacheService } from '../../infra/permission-cache.service';
import { AuditService } from '../audit/audit.service';
import { REDIS_CLIENT } from '../../infra/redis.module';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { TeamRole } from '../../common/utils/permission.util';
import { sanitizeFilename } from '../../common/utils/filename.util';

const SEARCH_CACHE_TTL = 300; // 检索缓存 5 分钟

export interface SearchHit {
  id: string;
  docId: string;
  text: string;
  score: number;
  source: string;
  kbId: string;
  documentId?: string | null;
  teamId?: string | null;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @InjectRepository(KnowledgeBase) private kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KbDocument) private kbDocRepo: Repository<KbDocument>,
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private ragClient: RagClient,
    private permCache: PermissionCacheService,
    private audit: AuditService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  /** 当前用户可访问的知识库(团队成员) */
  async listMine(user: CurrentUserData) {
    const teamIds = await this.permCache.visibleTeamIds(user.id);
    const qb = this.kbRepo.createQueryBuilder('kb');
    if (user.globalRole !== 'admin') {
      qb.where(teamIds.length ? 'kb.teamId IN (:...teamIds)' : '1=0', { teamIds });
    }
    const kbs = await qb.orderBy('kb.createdAt', 'DESC').getMany();
    const counts = await this.kbDocRepo
      .createQueryBuilder('kd')
      .select('kd.kbId', 'kbId')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(kd."chunkCount"),0)', 'chunks')
      .groupBy('kd.kbId')
      .getRawMany<{ kbId: string; cnt: string; chunks: string }>();
    const statMap = new Map(counts.map((r) => [r.kbId, r]));
    return kbs.map((kb) => ({
      ...kb,
      docCount: Number(statMap.get(kb.id)?.cnt ?? 0),
      chunkCount: Number(statMap.get(kb.id)?.chunks ?? 0),
    }));
  }

  async create(user: CurrentUserData, dto: { teamId: string; name: string; description?: string }) {
    const role = (await this.permCache.teamRole(user.id, dto.teamId)) as TeamRole | null;
    if (user.globalRole !== 'admin' && !role)
      throw new ForbiddenException('仅团队成员可创建知识库');
    const kb = await this.kbRepo.save(
      this.kbRepo.create({
        teamId: dto.teamId,
        name: dto.name,
        description: dto.description || null,
        ownerId: user.id,
      }),
    );
    await this.audit.log(user.id, user.username, 'KB_CREATE', `kb:${kb.id}`, { name: kb.name });
    return kb;
  }

  async listKbDocs(user: CurrentUserData, kbId: string) {
    await this.assertKbAccess(user, kbId);
    return this.kbDocRepo.find({ where: { kbId }, order: { createdAt: 'DESC' } });
  }

  /** 将团队文档切片入库(向量化) */
  async ingestDocument(user: CurrentUserData, kbId: string, documentId: string) {
    await this.assertKbAccess(user, kbId);
    const doc = await this.docRepo.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (doc.docType !== 'doc') throw new NotFoundException('文件夹无法入库,请选择文档');

    const kb = await this.kbRepo.findOneByOrFail({ id: kbId });
    if (kb.teamId !== doc.teamId)
      throw new ForbiddenException('仅能导入本团队的文档');

    // 幂等入库: 同一文档重复导入时先清理旧记录与向量
    const oldRecs = await this.kbDocRepo.find({ where: { kbId, documentId } });
    for (const old of oldRecs) {
      await this.ragClient.deleteDoc(kbId, old.id).catch(() => undefined);
      await this.kbDocRepo.delete({ id: old.id });
    }

    const rec = await this.kbDocRepo.save(
      this.kbDocRepo.create({
        kbId,
        documentId,
        sourceName: doc.title,
        status: 'pending',
      }),
    );
    try {
      const r = await this.ragClient.upsert(kbId, [
        {
          id: rec.id,
          docId: rec.id,
          text: `# ${doc.title}\n\n${doc.content}`,
          metadata: { documentId, title: doc.title, teamId: doc.teamId },
        },
      ]);
      await this.kbDocRepo.update({ id: rec.id }, { chunkCount: r.upserted, status: 'ready' });
      await this.invalidateSearchCache(kbId);
      await this.audit.log(user.id, user.username, 'KB_INGEST', `kb:${kbId}`, {
        documentId,
        chunks: r.upserted,
      });
      return { ...rec, chunkCount: r.upserted, status: 'ready' };
    } catch (e) {
      await this.kbDocRepo.update({ id: rec.id }, { status: 'failed' });
      throw e;
    }
  }

  /** 文件直接上传入库(不经过文档库) */
  async ingestFile(
    user: CurrentUserData,
    kbId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    await this.assertKbAccess(user, kbId);
    const filename = sanitizeFilename(file.originalname);
    const text = await this.ragClient.parseFile(file.buffer, filename);
    const rec = await this.kbDocRepo.save(
      this.kbDocRepo.create({ kbId, sourceName: filename, status: 'pending' }),
    );
    try {
      const r = await this.ragClient.upsert(kbId, [
        {
          id: rec.id,
          docId: rec.id,
          text: `# ${filename}\n\n${text}`,
          metadata: { title: filename },
        },
      ]);
      await this.kbDocRepo.update({ id: rec.id }, { chunkCount: r.upserted, status: 'ready' });
      await this.invalidateSearchCache(kbId);
      return { ...rec, chunkCount: r.upserted, status: 'ready' };
    } catch (e) {
      await this.kbDocRepo.update({ id: rec.id }, { status: 'failed' });
      throw e;
    }
  }

  async removeKbDoc(user: CurrentUserData, kbId: string, recId: string) {
    await this.assertKbAccess(user, kbId);
    const rec = await this.kbDocRepo.findOne({ where: { id: recId, kbId } });
    if (!rec) throw new NotFoundException('记录不存在');
    await this.ragClient.deleteDoc(kbId, rec.id).catch((e) => this.logger.warn(e.message));
    await this.kbDocRepo.delete({ id: rec.id });
    await this.invalidateSearchCache(kbId);
    return true;
  }

  /**
   * 混合检索入口:
   * 1. Redis 缓存相同 (kbIds+query) 的结果,降低向量库压力;
   * 2. 对命中文档做结果级权限过滤,规避越权风险;
   */
  async search(
    user: CurrentUserData,
    kbIds: string[],
    query: string,
    topK = 5,
  ): Promise<SearchHit[]> {
    for (const kbId of kbIds) await this.assertKbAccess(user, kbId, 'read');
    if (!query.trim()) return [];

    // 缓存键纳入各库版本号: 入库/删除递增版本即令旧缓存全部失效
    const pairs: Array<[string, string]> = [];
    for (const kbId of kbIds) {
      let ver = '0';
      try {
        ver = (await this.redis.get(`rag:ver:${kbId}`)) || '0';
      } catch {
        /* Redis 不可用时退化为 0 */
      }
      pairs.push([kbId, ver]);
    }
    pairs.sort((a, b) => a[0].localeCompare(b[0]));
    const cacheKey = `rag:search:${createHash('sha1')
      .update(JSON.stringify({ kbs: pairs, query, topK }))
      .digest('hex')}`;

    let hits: SearchHit[] | null = null;
    let fromCache = false;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        hits = JSON.parse(cached);
        fromCache = true;
      }
    } catch {
      /* Redis 不可用直接查 */
    }

    if (!hits) {
      const r = await this.ragClient.search(kbIds, query, topK);
      hits = r.results.map((x) => ({
        id: x.id,
        docId: x.docId,
        text: x.text,
        score: x.score,
        source: x.source || x.metadata?.title || '知识库',
        kbId: (x as any).kbId || kbIds[0],
        documentId: (x.metadata?.documentId as string | undefined) ?? null,
        teamId: (x.metadata?.teamId as string | undefined) ?? null,
      }));
      // 结果级权限过滤: 命中片段所属知识库必须仍在授权集合内
      const allowed = new Set(kbIds);
      hits = hits.filter((h) => !h.kbId || allowed.has(h.kbId));
      try {
        await this.redis.set(cacheKey, JSON.stringify(hits), 'EX', SEARCH_CACHE_TTL);
      } catch {
        /* ignore */
      }
    }

    this.logger.debug(
      `检索 "${query}" kb=${kbIds.join(',')} 命中 ${hits.length} 条${fromCache ? '(缓存)' : ''}`,
    );
    return hits;
  }

  private async assertKbAccess(user: CurrentUserData, kbId: string, action: 'read' | 'manage' = 'manage') {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (user.globalRole === 'admin') return kb;
    const role = (await this.permCache.teamRole(user.id, kb.teamId)) as TeamRole | null;
    if (!role) throw new ForbiddenException('无该知识库访问权限');
    if (action === 'manage' && !['owner', 'admin'].includes(role))
      throw new ForbiddenException('仅团队管理员可管理知识库');
    return kb;
  }

  private async invalidateSearchCache(kbId: string) {
    try {
      // 简单失效: 按前缀删除成本高,采用短 TTL 策略 + 版本键
      await this.redis.incr(`rag:ver:${kbId}`);
      await this.redis.expire(`rag:ver:${kbId}`, 86400);
    } catch {
      /* ignore */
    }
  }
}
