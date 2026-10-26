import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import {
  RATE_LIMIT_DEFAULT,
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';
import { REDIS_CLIENT } from '../../infra/redis.module';

/**
 * 基于 Redis 的固定窗口限流守卫,拦截高频请求。
 * 命中限流返回 429,并携带 Retry-After 头。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private reflector: Reflector,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? RATE_LIMIT_DEFAULT;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const ip =
      request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      request.ip ||
      'unknown';

    let identity: string;
    switch (options.scope) {
      case 'ip':
        identity = `ip:${ip}`;
        break;
      case 'user+ip':
        identity = `${user?.id ?? 'anon'}:${ip}`;
        break;
      default:
        identity = user?.id ? `user:${user.id}` : `ip:${ip}`;
    }

    const window = options.windowSec ?? 60;
    const bucket = Math.floor(Date.now() / 1000 / window);
    const key = `rl:${options.name}:${identity}:${bucket}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, window + 5);
      if (count > options.limit) {
        this.logger.warn(
          `限流触发 [${options.name}] ${identity} ${count}/${options.limit}`,
        );
        throw new HttpException(
          { code: 4290, message: '请求过于频繁,请稍后再试' },
          429,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis 不可用时降级放行,避免阻断全部业务
      this.logger.error(`限流计数失败(降级放行): ${e.message}`);
    }
    return true;
  }
}
