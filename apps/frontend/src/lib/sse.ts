/** 基于 fetch 的 SSE 客户端: 解析 data: 事件行,支持中止 */

import { API_BASE, getToken } from './request';

export interface SseHandlers {
  onEvent: (event: any) => void;
  onError?: (err: Error) => void;
  onFinish?: () => void;
}

export async function postSSE(path: string, body: any, handlers: SseHandlers) {
  const controller = new AbortController();
  let closed = false;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      let message = `连接失败 (${res.status})`;
      try {
        const j = await res.json();
        if (j.message) message = j.message;
      } catch {}
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按空行切分事件
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const event = JSON.parse(payload);
              handlers.onEvent(event);
              if (event.type === 'done' || event.type === 'error') {
                closed = true;
              }
            } catch {
              /* 忽略非 JSON 行 */
            }
          }
        }
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') handlers.onError?.(e);
  } finally {
    handlers.onFinish?.();
  }

  return {
    abort: () => {
      if (!closed) controller.abort();
    },
  };
}
