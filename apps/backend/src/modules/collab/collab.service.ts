import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as Y from 'yjs';
import { Document } from '../documents/entities/document.entity';
import { DocumentVersion } from '../documents/entities/document-version.entity';
import { AuditService } from '../audit/audit.service';
import { PermissionCacheService } from '../../infra/permission-cache.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import {
  actionSatisfies,
  effectiveDocAction,
  PermAction,
  TeamRole,
} from '../../common/utils/permission.util';

interface CollabRoom {
  docId: string;
  ydoc: Y.Doc;
  dirty: boolean;
  /** 上次落库的全文,内容未变时跳过写库,避免空转 version 自增 */
  savedContent: string;
  flushTimer: NodeJS.Timeout | null;
  /** 历史版本快照节流:高频落库但快照/审计按最小间隔记录 */
  lastSnapshotAt: number;
  lastEditor: { userId: string; username: string } | null;
}

const FLUSH_INTERVAL_MS = 2000;
const SNAPSHOT_MIN_INTERVAL_MS = 30_000;

/**
 * 协同房间服务:每篇文档一个内存 Y.Doc 作为房间内唯一权威,
 * 编辑增量实时合流,脏后定时把全文落回 documents(复用 version + 历史版本机制)。
 * 与 DocumentsService.update 的区别:房间串行写库,不需要乐观锁(version 冲突仅适用于 HTTP 直存路径)。
 */
@Injectable()
export class CollabService {
  private readonly logger = new Logger(CollabService.name);
  private readonly rooms = new Map<string, CollabRoom>();

  /** 落库成功后由网关注册的广播回调(向房间推送最新 version) */
  onSaved: ((docId: string, version: number, savedAt: Date) => void) | null = null;

  /** 房间被外部重置(历史恢复/删除/HTTP 覆盖保存)时由网关注册的回调(断开房间内连接,客户端重连取新状态) */
  onRoomReset: ((docId: string) => void) | null = null;

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    @InjectRepository(DocumentVersion) private versionRepo: Repository<DocumentVersion>,
    private permCache: PermissionCacheService,
    private audit: AuditService,
  ) {}

  /**
   * 进房权限判定:与 PermissionGuard.checkDocument 同一套三件套
   * (admin 放行 → 团队角色 + 文档授权 → effectiveDocAction),返回有效动作供网关区分只读/可编辑。
   */
  async assertDocPermission(
    user: CurrentUserData,
    docId: string,
  ): Promise<PermAction | null> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (user.globalRole === 'admin') return 'manage';
    const [teamRole, docRole] = await Promise.all([
      this.permCache.teamRole(user.id, doc.teamId),
      this.permCache.docRole(user.id, docId),
    ]);
    return effectiveDocAction(teamRole as TeamRole | null, (docRole as any) ?? null);
  }

  isEditableAction(action: PermAction | null): boolean {
    return !!action && actionSatisfies(action, 'write');
  }

  /** 取(或惰性创建)文档房间:首次创建时以数据库当前全文初始化 Y.Text */
  async getRoom(docId: string): Promise<CollabRoom> {
    let room = this.rooms.get(docId);
    if (room) return room;
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    const ydoc = new Y.Doc();
    if (doc.content) ydoc.getText('content').insert(0, doc.content);
    room = {
      docId,
      ydoc,
      dirty: false,
      savedContent: doc.content,
      flushTimer: null,
      lastSnapshotAt: Date.now(),
      lastEditor: null,
    };
    this.rooms.set(docId, room);
    return room;
  }

  applyUpdate(room: CollabRoom, update: Uint8Array, origin?: string) {
    Y.applyUpdate(room.ydoc, update, origin);
  }

  encodeState(room: CollabRoom): Uint8Array {
    return Y.encodeStateAsUpdate(room.ydoc);
  }

  currentText(room: CollabRoom): string {
    return room.ydoc.getText('content').toString();
  }

  currentVersion(room: CollabRoom): Promise<number> {
    return this.docRepo.findOne({ where: { id: room.docId } }).then((d) => d?.version ?? 1);
  }

  /** 房间有新编辑:标脏并(重)启动落库定时器 */
  markDirty(room: CollabRoom, editor: { userId: string; username: string }) {
    room.dirty = true;
    room.lastEditor = editor;
    if (room.flushTimer) clearTimeout(room.flushTimer);
    room.flushTimer = setTimeout(() => {
      room.flushTimer = null;
      this.flush(room).catch((e) => this.logger.error(`定时落库失败: ${e.message}`));
    }, FLUSH_INTERVAL_MS);
  }

  /** 全文落库:内容未变跳过;快照与审计按最小间隔节流;关闭房间时强制快照 */
  async flush(room: CollabRoom, opts: { closing?: boolean } = {}) {
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    const text = this.currentText(room);
    if (text === room.savedContent) {
      if (opts.closing) this.rooms.delete(room.docId);
      return;
    }
    const doc = await this.docRepo.findOne({ where: { id: room.docId } });
    if (!doc) {
      this.rooms.delete(room.docId);
      return;
    }
    const now = Date.now();
    const shouldSnapshot =
      opts.closing || now - room.lastSnapshotAt >= SNAPSHOT_MIN_INTERVAL_MS;
    if (shouldSnapshot) await this.snapshotVersion(doc);
    const nextVersion = doc.version + 1;
    await this.docRepo.update(
      { id: doc.id },
      { content: text, version: nextVersion, updatedBy: room.lastEditor?.userId ?? doc.updatedBy },
    );
    room.savedContent = text;
    room.dirty = false;
    if (shouldSnapshot) {
      room.lastSnapshotAt = now;
      if (room.lastEditor) {
        await this.audit.log(
          room.lastEditor.userId,
          room.lastEditor.username,
          'DOC_COLLAB_SAVE',
          `doc:${doc.id}`,
          { version: nextVersion },
        );
      }
    }
    this.onSaved?.(room.docId, nextVersion, new Date());
    if (opts.closing) this.rooms.delete(room.docId);
  }

  /** 最后一个连接离开:立即落库并销毁房间 */
  async closeRoom(docId: string) {
    const room = this.rooms.get(docId);
    if (!room) return;
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    await this.flush(room, { closing: true }).catch((e) =>
      this.logger.error(`关闭房间落库失败: ${e.message}`),
    );
    if (room.flushTimer) clearTimeout(room.flushTimer);
  }

  /**
   * 丢弃房间内存态(不落库):文档被恢复历史/删除/HTTP 覆盖保存后,数据库成为新权威,
   * 旧房间内容作废;由 onRoomReset 通知网关断开连接,客户端重连后按数据库重建。
   */
  resetRoom(docId: string) {
    const room = this.rooms.get(docId);
    if (!room) return; // 无活跃房间,无需重置
    if (room.flushTimer) clearTimeout(room.flushTimer);
    this.rooms.delete(docId);
    this.onRoomReset?.(docId);
  }

  /** 与 DocumentsService.snapshot 同构:保存前把数据库旧内容写入历史,保留最近 30 条 */
  private async snapshotVersion(doc: Document) {
    await this.versionRepo.save(
      this.versionRepo.create({
        documentId: doc.id,
        version: doc.version,
        title: doc.title,
        content: doc.content,
        createdBy: doc.updatedBy ?? 'collab',
      }),
    );
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
}
