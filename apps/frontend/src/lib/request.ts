/** 统一请求封装: 自动携带 Token、GET 请求缓存与去重、统一错误处理 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3002/api';

interface ReqOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: any;
  /** GET 结果内存缓存时长(ms),0 表示不缓存 */
  cacheMs?: number;
  signal?: AbortSignal;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  code: number;
  status: number;
  payload: any;
  constructor(message: string, code: number, status: number, payload?: any) {
    super(message);
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

const memoryCache = new Map<string, { at: number; data: any }>();
const inflight = new Map<string, Promise<any>>();

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('zxh_token');
}

export function clearAuthCache() {
  if (typeof window !== 'undefined') localStorage.removeItem('zxh_token');
  memoryCache.clear();
}

export async function request<T = any>(path: string, options: ReqOptions = {}): Promise<T> {
  const { method = 'GET', body, cacheMs, signal } = options;
  const url = `${API_BASE}${path}`;
  const token = getToken();

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // GET 缓存 + 并发去重,减少重复请求
  if (method === 'GET' && cacheMs !== 0) {
    const ttl = cacheMs ?? 10_000;
    if (ttl > 0) {
      const hit = memoryCache.get(url);
      if (hit && Date.now() - hit.at < ttl) return hit.data as T;
      if (inflight.has(url)) return inflight.get(url) as Promise<T>;
    }
  }

  const p = (async () => {
    const res = await fetch(url, {
      method,
      headers,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (res.status === 401) {
      clearAuthCache();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError('登录已失效,请重新登录', 4010, 401);
    }

    let json: Envelope<T> | null = null;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(`服务响应异常 (${res.status})`, res.status * 10, res.status);
    }

    if (!res.ok || json.code !== 0) {
      throw new ApiError(json.message || `请求失败 (${res.status})`, json.code ?? res.status * 10, res.status, json.data);
    }
    return json.data;
  })();

  if (method === 'GET') {
    const ttl = cacheMs ?? 10_000;
    if (ttl > 0) {
      inflight.set(url, p);
      p.finally(() => inflight.delete(url));
      p.then((data) => memoryCache.set(url, { at: Date.now(), data })).catch(() => {});
    }
  }
  return p;
}

export const api = {
  get: <T = any>(path: string, opts?: Omit<ReqOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T = any>(path: string, body?: any, opts?: Omit<ReqOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T = any>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};
