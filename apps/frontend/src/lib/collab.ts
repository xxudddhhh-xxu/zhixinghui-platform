'use client';

/**
 * 多人实时协同编辑客户端(Yjs CRDT + socket.io):
 * - 本地编辑:公共前后缀法把新旧全文压缩为单次 delete+insert 应用到 Y.Text,随 update 广播;
 * - 远端合流:服务端权威状态/他人增量 applyUpdate 后,回调新全文及变化位置(供光标平移);
 * - 断线降级:连接失败超阈值回调 onFallback,由编辑器切回"防抖+乐观锁"离线保存模式。
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { API_BASE, getToken } from './request';

export interface CollabMember {
  userId: string;
  nickname: string;
}

export interface CollabHandlers {
  /** 远端编辑到达:next 为合流后全文,meta.pos 为首个变化点、meta.delta 为净长度变化(用于光标平移) */
  onRemoteChange: (next: string, meta: { pos: number; delta: number }) => void;
  /** 进房成功(含服务端判定的只读标记与当前版本号) */
  onJoined: (version: number, readonly: boolean) => void;
  /** 服务端权威落库完成 */
  onSaved: (version: number) => void;
  /** 房间成员变化 */
  onMembers: (members: CollabMember[]) => void;
  /** 他人输入状态变化 */
  onAwareness: (peer: { userId: string; nickname: string; editing: boolean }) => void;
  /** 权限变更:permission=被断开,downgraded=降为只读,refresh=文档被外部重置需重建协同态 */
  onKicked: (reason: 'permission' | 'downgraded' | 'refresh') => void;
  /** 协同不可用,降级为离线保存模式 */
  onFallback: () => void;
}

export type CollabStatus = 'connecting' | 'live' | 'fallback';

/** WS 地址:默认由 API_BASE 推导(同源同端口,socket.io 共享 HTTP 服务),可用 NEXT_PUBLIC_WS_URL 覆盖 */
function collabUrl(): string {
  const custom = process.env.NEXT_PUBLIC_WS_URL;
  if (custom) return custom;
  return `${API_BASE.replace(/\/api\/?$/, '')}/collab`;
}

/** 增量/状态统一走 base64 字符串:polling 传输下二进制 packet(尤其 ack 附件)会被破坏 */
const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const fromB64 = (b64: unknown): Uint8Array | null => {
  if (typeof b64 !== 'string' || !b64.length) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

/** 把全量新旧字符串差异压缩为一次删除+插入(公共前后缀法) */
export function diffToOp(prev: string, next: string) {
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev--;
    endNext--;
  }
  return {
    index: start,
    removeLen: endPrev - start,
    insert: next.slice(start, endNext),
  };
}

/**
 * @param epoch 变化时销毁并重建整套协同会话(全新 Y.Doc + 全新连接):
 * 用于"文档被恢复历史/覆盖保存"后按数据库新状态重连,丢弃本地未合流的旧内存态
 */
export function useCollabDoc(
  docId: string,
  enabled: boolean,
  handlers: CollabHandlers,
  epoch = 0,
) {
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const ydocRef = useRef<Y.Doc | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastValueRef = useRef('');
  const editingSentAtRef = useRef(0);
  const editingOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !docId) return;
    const token = getToken();
    if (!token) {
      setStatus('fallback');
      handlersRef.current.onFallback();
      return;
    }

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('content');
    lastValueRef.current = '';

    const socket = io(collabUrl(), {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 4,
      reconnectionDelay: 1000,
      timeout: 8000,
    });
    socketRef.current = socket;

    let joined = false;
    let failCount = 0;
    const giveUp = () => {
      setStatus('fallback');
      socket.disconnect();
      handlersRef.current.onFallback();
    };

    // 本地/合并产生的增量广播给服务端;来自服务端的增量(origin='server')不回发,避免回声
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'server') return;
      socket.emit('collab:update', toB64(update));
    });

    // 远端合流后回调新全文与变化位置(本地编辑 transaction.local=true,不重复回调)
    ytext.observe((event) => {
      if (event.transaction.local) return;
      let pos = 0;
      let delta = 0;
      for (const d of event.delta as any[]) {
        if (typeof d.retain === 'number') pos += d.retain;
        else if (typeof d.insert === 'string') delta += d.insert.length;
        else if (typeof d.delete === 'number') delta -= d.delete;
      }
      lastValueRef.current = ytext.toString();
      handlersRef.current.onRemoteChange(lastValueRef.current, { pos, delta });
    });

    socket.on('connect', () => {
      failCount = 0;
      socket.emit('collab:join', { docId }, (ack: any) => {
        if (!ack?.ok) {
          // 无权限/文档不存在:该用户仍可走 HTTP 详情接口,协同功能静默降级
          giveUp();
          return;
        }
        joined = true;
        const state = fromB64(ack.state);
        if (!state) {
          giveUp();
          return;
        }
        Y.applyUpdate(ydoc, state, 'server');
        // 上行本端全量状态:首次为空合并,断线重连时携带离线期间的本地编辑(CRDT 自动合流)
        socket.emit('collab:update', toB64(Y.encodeStateAsUpdate(ydoc)));
        lastValueRef.current = ytext.toString();
        setStatus('live');
        handlersRef.current.onJoined(ack.version, !!ack.readonly);
        handlersRef.current.onMembers(ack.members ?? []);
      });
    });

    socket.on('collab:update', (payload: unknown) => {
      const update = fromB64(payload);
      if (update) Y.applyUpdate(ydoc, update, 'server');
    });
    socket.on('collab:members', (p: any) => handlersRef.current.onMembers(p?.members ?? []));
    socket.on('collab:awareness', (p: any) => handlersRef.current.onAwareness(p));
    socket.on('collab:saved', (p: any) => handlersRef.current.onSaved(p?.version));
    socket.on('collab:kicked', (p: any) => {
      const reason = p?.reason ?? 'permission';
      if (reason === 'downgraded') {
        // 降为只读:保持连接继续接收他人更新
        handlersRef.current.onKicked('downgraded');
        return;
      }
      handlersRef.current.onKicked(reason);
      socket.disconnect();
      if (reason === 'permission') setStatus('fallback');
      // refresh 由调用方递增 epoch 触发 effect 重建,无需置 fallback
    });
    socket.on('connect_error', () => {
      failCount += 1;
      if (!joined && failCount >= 3) giveUp();
    });
    // 注意:reconnect_failed/reconnect_attempt 是 Manager(socket.io)级事件,socket 实例上收不到
    socket.io.on('reconnect_failed', giveUp);
    // 断线后状态回退为"连接中":已进房连接被服务端/网络断开时,
    // UI 不能继续伪装"实时协同"(否则本地编辑只写内存 Y.Doc,永远发不出去);
    // 重连成功会重新 join 并回到 live,多次重试耗尽走 reconnect_failed → fallback。
    socket.on('disconnect', (reason) => {
      if (joined && reason !== 'io client disconnect') setStatus('connecting');
    });

    return () => {
      if (editingOffTimerRef.current) clearTimeout(editingOffTimerRef.current);
      socket.removeAllListeners();
      socket.disconnect();
      ydoc.destroy();
      ydocRef.current = null;
      socketRef.current = null;
    };
  }, [docId, enabled, epoch]);

  /** 编辑器 onChange 调用:diff 压缩后写入 Y.Text 并自动广播 */
  const applyLocalEdit = (newValue: string) => {
    const prev = lastValueRef.current;
    if (newValue === prev) return;
    lastValueRef.current = newValue;
    const yd = ydocRef.current;
    if (!yd) return;
    const yt = yd.getText('content');
    const { index, removeLen, insert } = diffToOp(prev, newValue);
    if (removeLen > 0) yt.delete(index, removeLen);
    if (insert) yt.insert(index, insert);
  };

  /** 编辑器输入时调用:节流广播"正在输入",停顿 1.5s 后广播停止 */
  const notifyEditing = () => {
    const socket = socketRef.current;
    if (!socket || status !== 'live') return;
    const now = Date.now();
    if (now - editingSentAtRef.current > 1200) {
      editingSentAtRef.current = now;
      socket.emit('collab:awareness', { editing: true });
    }
    if (editingOffTimerRef.current) clearTimeout(editingOffTimerRef.current);
    editingOffTimerRef.current = setTimeout(() => {
      socketRef.current?.emit('collab:awareness', { editing: false });
    }, 1500);
  };

  return { status, applyLocalEdit, notifyEditing };
}
