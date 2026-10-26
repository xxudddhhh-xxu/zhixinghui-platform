import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Python RAG 服务客户端: 切片 / 嵌入入库 / 混合检索 / 文件解析。
 * 全部带超时与异常兜底。
 */
@Injectable()
export class RagClient {
  private readonly logger = new Logger(RagClient.name);
  private readonly base = process.env.RAG_SERVICE_URL || 'http://localhost:8000';

  private async request<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const { timeoutMs = 15_000, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...rest,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`RAG 服务 ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.request<any>('/health', { timeoutMs: 3000 });
      return r?.status === 'ok';
    } catch {
      return false;
    }
  }

  async parseFile(buffer: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);
    const r = await this.request<{ text: string }>('/parse', {
      method: 'POST',
      body: form,
      timeoutMs: 60_000,
    });
    return r.text;
  }

  async upsert(kbId: string, points: { id: string; docId: string; text: string; metadata?: Record<string, any> }[]) {
    return this.request<{ upserted: number }>(`/kb/${kbId}/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      timeoutMs: 120_000,
    });
  }

  async search(kbIds: string[], query: string, topK = 5) {
    return this.request<{
      results: {
        id: string;
        docId: string;
        text: string;
        score: number;
        source: string;
        metadata: Record<string, any>;
      }[];
    }>('/kb/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kb_ids: kbIds, query, top_k: topK }),
      timeoutMs: 20_000,
    });
  }

  async deleteKb(kbId: string) {
    return this.request(`/kb/${kbId}`, { method: 'DELETE' });
  }

  async deleteDoc(kbId: string, docId: string) {
    return this.request(`/kb/${kbId}/doc/${docId}`, { method: 'DELETE' });
  }

  /** 向量库不可用时的统一兜底错误 */
  ensureAvailable(ok: boolean) {
    if (!ok)
      throw new ServiceUnavailableException(
        'RAG 服务不可用,请确认 Python 服务已启动 (services/rag)',
      );
  }
}
