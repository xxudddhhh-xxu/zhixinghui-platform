import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 安全审计日志: 登录/越权尝试/资源变更全量留痕 */
@Entity('audit_logs')
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ length: 64, default: 'anonymous' })
  username: string;

  /** LOGIN / LOGIN_FAILED / DOC_CREATE / DOC_DELETE / PERM_DENIED ... */
  @Column({ length: 48 })
  action: string;

  /** 资源标识,如 doc:<uuid> / team:<uuid> */
  @Column({ length: 80 })
  resource: string;

  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, any>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
