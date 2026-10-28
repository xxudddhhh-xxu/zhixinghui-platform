import { Logger, Inject } from '@nestjs/common';
import {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis.module';
import { PERM_INVALIDATE_CHANNEL } from '../../infra/permission-cache.service';
import { validateJwtPayload, JwtPayload } from '../auth/jwt.strategy';
import { UsersService } from '../users/users.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PermAction } from '../../common/utils/permission.util';
import { CollabService } from './collab.service';

interface SocketMeta {
  userId: string;
  username: string;
  nickname: string;
  docId: string;
  /** 权限判定后的只读标记:只读连接的 update 一律丢弃 */
  readonly: boolean;
}

/** 增量/状态统一走 base64 字符串:polling 传输下 ack 二进制 attachment 会被破坏,文本通道最稳 */
const toB64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const fromB64 = (s: unknown): Uint8Array | null => {
  if (typeof s !== 'string' || !s.length) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.length ? new Uint8Array(buf) : null;
};

/**
 * 协同编辑网关(权限三卡口,复用既有鉴权体系):
 * ① 握手认证 = JwtAuthGuard 等价:handshake 携带 token(localStorage 无法带 Authorization 头),验签 + 查库;
 * ② 进房授权 = PermissionGuard 等价:effectiveDocAction 判定,null 拒绝 / read 只读 / write 可编辑;
 * ③ 变更踢人 = 订阅 perm:invalidate(快照失效即广播),对该用户在线连接重算权限,降级只读或断开。
 * 房间内 Y.Doc 增量由本网关纯转发 + 服务端权威合流,不经过 HTTP 守卫链(guard 已对 ws 上下文短路)。
 */
@WebSocketGateway({
  namespace: '/collab',
  cors: { origin: true, credentials: true },
})
export class CollabGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabGateway.name);
  @WebSocketServer() server: Server;

  /** 本网关命名空间:Nest 注入的 @WebSocketServer 实际是 /collab 的 Namespace(非根 io),
   *  故 sockets 广播/to()/in() 直接可用;socket 查找用 ns.sockets.get(sid)(Map)而非 sockets.sockets */
  private get ns(): Namespace {
    return this.server as unknown as Namespace;
  }

  private readonly sockets = new Map<string, SocketMeta>();
  private readonly byUser = new Map<string, Set<string>>();
  private sub: Redis | null = null;
  private recheckTimer: NodeJS.Timeout | null = null;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private collab: CollabService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  onModuleInit() {
    this.collab.onSaved = (docId, version, savedAt) => {
      this.ns?.to(docId).emit('collab:saved', { docId, version, savedAt });
    };
    this.collab.onRoomReset = (docId) => this.evictDoc(docId, 'refresh');
    // 订阅权限失效广播(与 HTTP 权限快照失效同源):即时降级/踢出协同连接
    try {
      this.sub = this.redis.duplicate(); // 继承父连接配置,创建即自动连接,命令在就绪前排队
      this.sub.on('error', () => {});
      this.sub.subscribe(PERM_INVALIDATE_CHANNEL);
      this.sub.on('message', (_ch, msg) => {
        try {
          const ids: string[] = JSON.parse(msg);
          this.logger.log(`收到权限失效广播: ${JSON.stringify(ids)}`);
          ids.forEach((id) => this.recheckUser(id));
        } catch {
          /* 忽略非法消息 */
        }
      });
    } catch {
      this.logger.warn('权限失效订阅建立失败,仅依赖定时重校验兜底');
    }
    // 60s 兜底重校验(事件通道异常时保证权限变更最迟 1 分钟生效)
    this.recheckTimer = setInterval(() => this.recheckAll(), 60_000);
  }

  onModuleDestroy() {
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.sub?.disconnect();
  }

  /** 卡口①:握手认证,失败直接断开;结果同时存为 promise 供消息处理器等待(异步握手期间消息可能先到) */
  async handleConnection(client: Socket) {
    client.data.userReady = (async () => {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token || typeof token !== 'string') throw new Error('缺少 token');
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await validateJwtPayload(this.usersService, payload);
      client.data.user = user;
      return user;
    })();
    try {
      await client.data.userReady;
    } catch (e: any) {
      client.emit('collab:error', { message: '协同连接认证失败,请重新登录' });
      client.disconnect(true);
    }
  }

  /** 卡口②:进房授权,null 拒绝 / read 只读 / write·manage 可编辑 */
  @SubscribeMessage('collab:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { docId: string }) {
    const user = (client.data.user ??
      (await Promise.resolve(client.data.userReady).catch(() => undefined))) as
      | CurrentUserData
      | undefined;
    const docId = body?.docId;
    if (!user || !docId) return { ok: false, message: '参数缺失' };

    let action: PermAction | null = null;
    try {
      action = await this.collab.assertDocPermission(user, docId);
    } catch {
      return { ok: false, message: '文档不存在' };
    }
    if (!action) return { ok: false, message: '无该文档访问权限' };

    // 已在其他房间则先退出旧房间
    this.leaveRoom(client, false);

    const room = await this.collab.getRoom(docId);
    const readonly = !this.collab.isEditableAction(action);
    await client.join(docId);
    this.sockets.set(client.id, {
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      docId,
      readonly,
    });
    this.pushUserSocket(user.id, client.id);
    this.broadcastMembers(docId);

    const [state, version] = await Promise.all([
      Promise.resolve(this.collab.encodeState(room)),
      this.collab.currentVersion(room),
    ]);
    return {
      ok: true,
      state: toB64(state),
      version,
      readonly,
      members: this.membersOf(docId),
      myAction: action,
    };
  }

  /** 编辑增量:只读连接丢弃;其余 applyUpdate 到权威 ydoc 并转发房间其他人 */
  @SubscribeMessage('collab:update')
  onUpdate(@ConnectedSocket() client: Socket, @MessageBody() update: string) {
    const meta = this.sockets.get(client.id);
    const bytes = fromB64(update);
    if (!meta || meta.readonly || !bytes) return;
    this.collab
      .getRoom(meta.docId)
      .then((r) => {
        this.collab.applyUpdate(r, bytes, client.id);
        this.collab.markDirty(r, { userId: meta.userId, username: meta.username });
        client.to(meta.docId).emit('collab:update', toB64(bytes));
      })
      .catch(() => client.emit('collab:error', { message: '房间已失效,请刷新' }));
  }

  /** 在场状态(输入中):仅转发,不落库 */
  @SubscribeMessage('collab:awareness')
  onAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { editing?: boolean },
  ) {
    const meta = this.sockets.get(client.id);
    if (!meta) return;
    client.to(meta.docId).emit('collab:awareness', {
      userId: meta.userId,
      nickname: meta.nickname,
      editing: !!body?.editing,
    });
  }

  async handleDisconnect(client: Socket) {
    this.leaveRoom(client, true);
  }

  private leaveRoom(client: Socket, closingAllowed: boolean) {
    const meta = this.sockets.get(client.id);
    if (!meta) return;
    this.sockets.delete(client.id);
    const set = this.byUser.get(meta.userId);
    set?.delete(client.id);
    if (!set?.size) this.byUser.delete(meta.userId);
    this.broadcastMembers(meta.docId);
    // 房间空了:立即落库并销毁(把房间权威态回写数据库)
    if (closingAllowed && !this.membersOf(meta.docId).length) {
      this.collab.closeRoom(meta.docId).catch((e) =>
        this.logger.error(`关闭房间失败: ${e.message}`),
      );
    }
  }

  /** 卡口③:对指定用户的在线协同连接重算权限 —— null 断开,失去 write 降为只读 */
  private async recheckUser(userId: string) {
    const socketIds = this.byUser.get(userId);
    this.logger.log(`重校验用户 ${userId}: 在线 socket ${socketIds?.size ?? 0} 个`);
    if (!socketIds?.size) return;
    for (const sid of [...socketIds]) {
      const meta = this.sockets.get(sid);
      const client = this.ns?.sockets?.get(sid);
      if (!meta || !client) {
        this.logger.warn(`socket 未找到: sid=${sid} meta=${!!meta} client=${!!client}`);
        continue;
      }
      let action: PermAction | null = null;
      try {
        const user = client.data.user as CurrentUserData;
        action = await this.collab.assertDocPermission(user, meta.docId);
        this.logger.log(`重校验结果 sid=${sid} doc=${meta.docId} action=${action}`);
      } catch {
        action = null;
      }
      if (!action) {
        client.emit('collab:kicked', { reason: 'permission' });
        client.disconnect(true);
        continue;
      }
      if (!this.collab.isEditableAction(action) && !meta.readonly) {
        meta.readonly = true;
        client.emit('collab:kicked', { reason: 'downgraded' });
      }
    }
  }

  private recheckAll() {
    for (const userId of this.byUser.keys()) this.recheckUser(userId);
  }

  /** 房间失效:通知客户端按新状态重连,并断开房间内全部连接 */
  private evictDoc(docId: string, reason: 'refresh') {
    this.ns?.in(docId).emit('collab:kicked', { reason });
    this.ns?.in(docId).disconnectSockets(true);
    for (const [sid, m] of [...this.sockets]) {
      if (m.docId !== docId) continue;
      this.sockets.delete(sid);
      const set = this.byUser.get(m.userId);
      set?.delete(sid);
      if (!set?.size) this.byUser.delete(m.userId);
    }
  }

  private pushUserSocket(userId: string, socketId: string) {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(socketId);
  }

  private membersOf(docId: string) {
    const seen = new Map<string, { userId: string; nickname: string }>();
    for (const m of this.sockets.values()) {
      if (m.docId === docId) seen.set(m.userId, { userId: m.userId, nickname: m.nickname });
    }
    return [...seen.values()];
  }

  private broadcastMembers(docId: string) {
    this.ns?.to(docId).emit('collab:members', { docId, members: this.membersOf(docId) });
  }
}
