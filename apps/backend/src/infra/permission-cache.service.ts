import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TeamMember } from '../modules/teams/entities/team-member.entity';
import { DocumentMember } from '../modules/documents/entities/document-member.entity';
import { REDIS_CLIENT } from './redis.module';

export interface PermissionSnapshot {
  /** teamId -> role */
  teams: Record<string, string>;
  /** docId -> role */
  docs: Record<string, string>;
  /** 用户可见的全部文档 ID(团队文档 + 单独授权文档) */
  visibleDocIds: string[];
  cachedAt: number;
}

const SNAP_KEY = (userId: string) => `perm:snap:${userId}`;
const SNAP_TTL_SEC = 600;

/** 权限失效广播频道:协同网关订阅后对在线连接实时重算权限(降只读/断开) */
export const PERM_INVALIDATE_CHANNEL = 'perm:invalidate';

/**
 * 权限快照服务:两级(团队 → 文档)角色权限模型。
 * 快照写入 Redis 缓存,鉴权守卫与前端按钮显隐共用,成员变更时主动失效。
 */
@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private redis: Redis,
    @InjectRepository(TeamMember)
    private teamMemberRepo: Repository<TeamMember>,
    @InjectRepository(DocumentMember)
    private docMemberRepo: Repository<DocumentMember>,
  ) {}

  async getSnapshot(userId: string): Promise<PermissionSnapshot> {
    try {
      const cached = await this.redis.get(SNAP_KEY(userId));
      if (cached) return JSON.parse(cached);
    } catch {
      this.logger.warn('Redis 不可用,权限快照降级为直查数据库');
    }
    const snap = await this.buildSnapshot(userId);
    try {
      await this.redis.set(SNAP_KEY(userId), JSON.stringify(snap), 'EX', SNAP_TTL_SEC);
    } catch {
      /* 降级:仅不缓存 */
    }
    return snap;
  }

  private async buildSnapshot(userId: string): Promise<PermissionSnapshot> {
    const [teamMembers, docMembers] = await Promise.all([
      this.teamMemberRepo.find({ where: { userId } }),
      this.docMemberRepo.find({ where: { userId } }),
    ]);
    const teams: Record<string, string> = {};
    for (const m of teamMembers) teams[m.teamId] = m.role;
    const docs: Record<string, string> = {};
    for (const m of docMembers) docs[m.documentId] = m.role;
    return {
      teams,
      docs,
      visibleDocIds: [...Object.keys(docs)],
      cachedAt: Date.now(),
    };
  }

  /** 成员变更后失效快照(可传团队成员列表对应的全部用户);同时广播事件供协同网关实时降级/踢出 */
  async invalidate(userIds: string | string[]) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    try {
      if (ids.length) {
        await this.redis.del(...ids.map(SNAP_KEY));
        await this.redis.publish(PERM_INVALIDATE_CHANNEL, JSON.stringify(ids));
      }
    } catch {
      /* ignore */
    }
  }

  async teamRole(userId: string, teamId: string): Promise<string | null> {
    const snap = await this.getSnapshot(userId);
    return snap.teams[teamId] ?? null;
  }

  async docRole(userId: string, docId: string): Promise<string | null> {
    const snap = await this.getSnapshot(userId);
    return snap.docs[docId] ?? null;
  }

  /** 批量取用户在某团队下可见的文档 ID */
  async visibleDocIdsOfTeam(userId: string, teamId: string): Promise<string[] | null> {
    const snap = await this.getSnapshot(userId);
    if (!snap.teams[teamId]) return null;
    return snap.visibleDocIds;
  }

  async visibleTeamIds(userId: string): Promise<string[]> {
    const snap = await this.getSnapshot(userId);
    return Object.keys(snap.teams);
  }

  async isVisibleDoc(userId: string, docIds: string[]): Promise<Set<string>> {
    if (!docIds.length) return new Set();
    const snap = await this.getSnapshot(userId);
    const visible = new Set(snap.visibleDocIds);
    const teamIds = Object.keys(snap.teams);
    if (teamIds.length) {
      // 团队下的全部文档均可见(懒查库,数量有限)
      const { Document } = await import('../modules/documents/entities/document.entity');
      const docs = await this.docMemberRepo.manager.getRepository(Document).find({
        where: { teamId: In(teamIds) },
        select: ['id'],
      });
      docs.forEach((d) => visible.add(d.id));
    }
    return visible;
  }
}
