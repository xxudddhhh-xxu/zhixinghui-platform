import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private repo: Repository<AuditLog>,
  ) {}

  /** 异步落库,失败不影响主流程 */
  async log(
    userId: string | null,
    username: string,
    action: string,
    resource: string,
    detail: Record<string, any> = {},
    ip?: string,
  ) {
    try {
      await this.repo.save(
        this.repo.create({ userId, username, action, resource, detail, ip: ip ?? null }),
      );
    } catch (e) {
      this.logger.warn(`审计日志写入失败: ${action} ${e.message}`);
    }
  }

  async list({ page = 1, pageSize = 20, action, q }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (action) qb.andWhere('a.action = :action', { action });
    if (q) qb.andWhere('(a.username LIKE :q OR a.resource LIKE :q)', { q: `%${q}%` });
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }
}
