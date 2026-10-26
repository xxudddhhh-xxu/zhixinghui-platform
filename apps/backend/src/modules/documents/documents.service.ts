import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Document, DocType } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DocumentMember } from './entities/document-member.entity';
import { PermissionCacheService } from '../../infra/permission-cache.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { actionSatisfies, effectiveDocAction, TeamRole } from '../../common/utils/permission.util';
import { exportHtmlDocument } from '../../common/utils/markdown-lite.util';

export interface DocTreeNode {
  id: string;
  parentId: string | null;
  teamId: string;
  title: string;
  docType: DocType;
  isPublic: boolean;
  version: number;
  updatedAt: Date;
  /** 当前用户对该节点的有效动作: read/write/manage/null */
  myAction: 'read' | 'write' | 'manage' | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    @InjectRepository(DocumentVersion) private versionRepo: Repository<DocumentVersion>,
    @InjectRepository(DocumentMember) private docMemberRepo: Repository<DocumentMember>,
    private permCache: PermissionCacheService,
    private audit: AuditService,
  ) {}

  /**
   * 懒加载子节点: parentId=null 返回根。
   * 非团队成团队角色+文档授权双重过滤,实现部门知识隔离。
   */
  async children(user: CurrentUserData, teamId: string, parentId: string | null): Promise<DocTreeNode[]> {
    if (user.globalRole !== 'admin') {
      const teamRole = (await this.permCache.teamRole(user.id, teamId)) as TeamRole | null;
      if (!teamRole) throw new ForbiddenException('您不属于该团队,禁止访问其文档');
    }
    const docs = await this.docRepo.find({
      where: { teamId, parentId: parentId ? parentId : IsNull() },
      order: { docType: 'ASC', createdAt: 'ASC' },
    });

    const snap = await this.permCache.getSnapshot(user.id);
    const crossTeamIds = docs
      .filter((d) => !snap.teams[teamId])
      .map((d) => d.id)
      .filter((id) => !snap.docs[id]);
    // 团队内成员天然可见;跨团队仅授权文档可见——此处团队校验已通过,直接返回
    return docs.map((d) => ({
      id: d.id,
      parentId: d.parentId,
      teamId: d.teamId,
      title: d.title,
      docType: d.docType,
      isPublic: d.isPublic,
      version: d.version,
      updatedAt: d.updatedAt,
      myAction: this.nodeAction(user, snap.teams[teamId] as TeamRole | null, snap.docs[d.id] as any),
    }));
  }

  private nodeAction(user: CurrentUserData, teamRole: TeamRole | null, docRole: 'editor' | 'viewer' | null) {
    if (user.globalRole === 'admin') return 'manage' as const;
    return effectiveDocAction(teamRole, docRole);
  }

  /** 可见的全部团队(文档页顶部切换) */
  async visibleTeams(user: CurrentUserData) {
    const snap = await this.permCache.getSnapshot(user.id);
    return Object.entries(snap.teams).map(([id, role]) => ({ id, myRole: role }));
  }

  async detail(user: CurrentUserData, id: string) {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (user.globalRole !== 'admin') {
      const snap = await this.permCache.getSnapshot(user.id);
      const eff = effectiveDocAction(
        (snap.teams[doc.teamId] as TeamRole) ?? null,
        (snap.docs[id] as any) ?? null,
      );
      if (!eff) throw new ForbiddenException('无该文档访问权限(跨团队资源隔离)');
      return { ...doc, myAction: eff };
    }
    return { ...doc, myAction: 'manage' as const };
  }

  async create(user: CurrentUserData, dto: { teamId: string; parentId?: string | null; title: string; docType?: DocType; content?: string }) {
    if (dto.parentId) {
      const parent = await this.docRepo.findOne({ where: { id: dto.parentId } });
      if (!parent || parent.teamId !== dto.teamId)
        throw new BadRequestException('父节点不存在或不属于该团队');
    }
    const doc = await this.docRepo.save(
      this.docRepo.create({
        teamId: dto.teamId,
        parentId: dto.parentId ?? null,
        title: dto.title,
        docType: dto.docType ?? 'doc',
        content: dto.docType === 'folder' ? '' : dto.content ?? '',
        updatedBy: user.id,
      }),
    );
    await this.snapshot(doc, user.id);
    await this.audit.log(user.id, user.username, 'DOC_CREATE', `doc:${doc.id}`, { title: doc.title });
    return doc;
  }

  /**
   * 编辑保存(自动保存入口): 携带 version 做乐观锁,
   * 版本不一致返回 409 冲突,由前端提示恢复或覆盖。
   */
  async update(user: CurrentUserData, id: string, dto: { title?: string; content?: string; version: number; isPublic?: boolean }) {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (dto.version !== undefined && dto.version !== doc.version) {
      throw new ConflictException(
        JSON.stringify({
          code: 4090,
          message: '文档已被他人修改,存在编辑冲突',
          latestVersion: doc.version,
          updatedAt: doc.updatedAt,
        }),
      );
    }
    if (doc.docType === 'folder' && dto.content !== undefined)
      throw new BadRequestException('文件夹无正文内容');

    await this.snapshot(doc, user.id);
    const nextVersion = doc.version + 1;
    await this.docRepo.update(
      { id },
      {
        title: dto.title ?? doc.title,
        content: dto.content ?? doc.content,
        isPublic: dto.isPublic ?? doc.isPublic,
        version: nextVersion,
        updatedBy: user.id,
      },
    );
    await this.audit.log(user.id, user.username, 'DOC_UPDATE', `doc:${id}`, { version: nextVersion });
    return { id, version: nextVersion, updatedAt: new Date() };
  }

  /** 保存前快照历史版本 */
  private async snapshot(doc: Document, userId: string) {
    await this.versionRepo.save(
      this.versionRepo.create({
        documentId: doc.id,
        version: doc.version,
        title: doc.title,
        content: doc.content,
        createdBy: userId,
      }),
    );
    // 每文档最多保留 30 个版本
    const count = await this.versionRepo.count({ where: { documentId: doc.id } });
    if (count > 30) {
      const olds = await this.versionRepo.find({
        where: { documentId: doc.id },
        order: { version: 'ASC' },
        take: count - 30,
      });
      await this.versionRepo.delete({ id: In(olds.map((v) => v.id)) });
    }
  }

  async versions(user: CurrentUserData, id: string) {
    return this.versionRepo.find({
      where: { documentId: id },
      order: { version: 'DESC' },
      take: 30,
    });
  }

  async restoreVersion(user: CurrentUserData, id: string, version: number) {
    const v = await this.versionRepo.findOne({ where: { documentId: id, version } });
    if (!v) throw new NotFoundException('版本不存在');
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    await this.snapshot(doc, user.id);
    const nextVersion = doc.version + 1;
    await this.docRepo.update(
      { id },
      { title: v.title, content: v.content, version: nextVersion, updatedBy: user.id },
    );
    await this.audit.log(user.id, user.username, 'DOC_RESTORE', `doc:${id}`, { version });
    return { id, version: nextVersion };
  }

  async remove(user: CurrentUserData, id: string) {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    // 递归删除子树
    const all = await this.collectSubtree(id);
    await this.docRepo.delete({ id: In(all) });
    await this.versionRepo.delete({ documentId: In(all) });
    await this.docMemberRepo.delete({ documentId: In(all) });
    await this.audit.log(user.id, user.username, 'DOC_DELETE', `doc:${id}`, { title: doc.title });
    return true;
  }

  private async collectSubtree(rootId: string): Promise<string[]> {
    const result: string[] = [rootId];
    let frontier = [rootId];
    while (frontier.length) {
      const children = await this.docRepo.find({
        where: { parentId: In(frontier) },
        select: ['id'],
      });
      frontier = children.map((c) => c.id);
      result.push(...frontier);
    }
    return result;
  }

  async move(user: CurrentUserData, id: string, parentId: string | null) {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (parentId) {
      if (parentId === id) throw new BadRequestException('不能移动到自身');
      const parent = await this.docRepo.findOne({ where: { id: parentId } });
      if (!parent || parent.teamId !== doc.teamId)
        throw new BadRequestException('目标父节点无效');
      // 防环: parentId 链上不能包含 id
      const subtree = await this.collectSubtree(id);
      if (subtree.includes(parentId))
        throw new BadRequestException('不能移动到自己的子节点下');
    }
    await this.docRepo.update({ id }, { parentId });
    return true;
  }

  /** 从上传文件创建文档(txt/md 直接读文本,pdf/docx 交给 RAG 服务解析) */
  async createFromFile(
    user: CurrentUserData,
    teamId: string,
    parentId: string | null,
    filename: string,
    text: string,
  ) {
    const title = filename.replace(/\.[^.]+$/, '').slice(0, 200) || '未命名文档';
    return this.create(user, { teamId, parentId, title, docType: 'doc', content: text });
  }

  // ===== 文档级成员授权(跨团队共享) =====

  async listDocMembers(user: CurrentUserData, docId: string) {
    const members = await this.docMemberRepo.find({ where: { documentId: docId } });
    if (!members.length) return [];
    const { User } = await import('../users/entities/user.entity');
    const users = await this.docMemberRepo.manager.getRepository(User).find({
      where: { id: In(members.map((m) => m.userId)) },
    });
    const uMap = new Map(users.map((u) => [u.id, u]));
    return members
      .map((m) => ({
        id: m.id,
        userId: m.userId,
        username: uMap.get(m.userId)?.username ?? '?',
        nickname: uMap.get(m.userId)?.nickname ?? '?',
        role: m.role,
      }))
      .filter((x) => x.username !== '?');
  }

  async setDocMember(user: CurrentUserData, docId: string, userId: string, role: 'editor' | 'viewer' | null) {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (role === null) {
      await this.docMemberRepo.delete({ documentId: docId, userId });
    } else {
      const exists = await this.docMemberRepo.findOne({ where: { documentId: docId, userId } });
      if (exists) await this.docMemberRepo.update({ id: exists.id }, { role });
      else
        await this.docMemberRepo.save(
          this.docMemberRepo.create({ documentId: docId, userId, role }),
        );
    }
    await this.permCache.invalidate(userId);
    await this.audit.log(user.id, user.username, 'DOC_MEMBER_SET', `doc:${docId}`, { userId, role });
    return true;
  }

  /** 共享给我的跨团队文档(文档级授权的白名单入口) */
  async sharedDocs(user: CurrentUserData) {
    if (user.globalRole === 'admin') return [];
    const grants = await this.docMemberRepo.find({ where: { userId: user.id } });
    if (!grants.length) return [];
    const docs = await this.docRepo.find({ where: { id: In(grants.map((g) => g.documentId)) } });
    const snap = await this.permCache.getSnapshot(user.id);
    const { Team } = await import('../teams/entities/team.entity');
    const teams = await this.docMemberRepo.manager
      .getRepository(Team)
      .find({ where: { id: In([...new Set(docs.map((d) => d.teamId))]) } });
    const tMap = new Map(teams.map((t) => [t.id, t.name]));
    return docs
      .filter((d) => !snap.teams[d.teamId]) // 本团队文档已在左侧树内,不重复
      .map((d) => ({
        id: d.id,
        title: d.title,
        teamId: d.teamId,
        teamName: tMap.get(d.teamId) ?? '',
        myRole: (snap.docs[d.id] as string) ?? null,
        updatedAt: d.updatedAt,
      }));
  }

  /** 导出文档: md 原文 / html 网页 / doc(Word 兼容 HTML) */
  async exportDoc(user: CurrentUserData, id: string, format: 'md' | 'html' | 'doc') {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (user.globalRole !== 'admin') {
      const snap = await this.permCache.getSnapshot(user.id);
      const eff = effectiveDocAction(
        (snap.teams[doc.teamId] as TeamRole) ?? null,
        (snap.docs[id] as any) ?? null,
      );
      if (!eff) throw new ForbiddenException('无该文档访问权限(跨团队资源隔离)');
    }
    const safeName = (doc.title ?? 'document').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'document';
    await this.audit.log(user.id, user.username, 'DOC_EXPORT', `doc:${id}`, { format });
    if (format === 'md') {
      return {
        filename: `${safeName}.md`,
        contentType: 'text/markdown; charset=utf-8',
        body: `# ${doc.title}\n\n${doc.content ?? ''}`,
      };
    }
    return {
      filename: `${safeName}.${format}`,
      contentType:
        format === 'doc' ? 'application/msword; charset=utf-8' : 'text/html; charset=utf-8',
      body: exportHtmlDocument(doc.title, doc.content ?? '', format === 'doc'),
    };
  }

  /** 公开文档详情(ISR 页面数据,匿名可访问) */
  async publicDetail(id: string) {
    const doc = await this.docRepo.findOne({ where: { id, isPublic: true } });
    if (!doc) throw new NotFoundException('文档不存在或未公开');
    const { id: _id, teamId: _t, isPublic: _p, version: _v, updatedBy: _u, ...rest } = doc;
    return rest;
  }
}
