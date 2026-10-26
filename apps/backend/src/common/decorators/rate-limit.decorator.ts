import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  /** 窗口秒数,默认 60 */
  windowSec?: number;
  /** 窗口内最大请求数 */
  limit: number;
  /** 限流维度: 'user' 按 JWT 用户, 'ip' 按客户端 IP, 'user+ip' 两者拼接 */
  scope?: 'user' | 'ip' | 'user+ip';
  /** 限流键名(用于区分接口类别) */
  name: string;
}

export const RATE_LIMIT_KEY = 'rate-limit';
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/** 默认限流: 每用户每分钟 120 次 */
export const RATE_LIMIT_DEFAULT: RateLimitOptions = {
  name: 'default',
  limit: 120,
  windowSec: 60,
  scope: 'user',
};
