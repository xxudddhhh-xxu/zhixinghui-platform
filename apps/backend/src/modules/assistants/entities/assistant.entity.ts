import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 智能助手: 可配置 AI 的角色、性格、
 * 可回答的问题范围、禁止回答的范围,
 * 以及"优先从知识库检索,无答案再 AI 自由回答"的策略。
 */
@Entity('assistants')
@Index(['userId'])
export class Assistant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ length: 64 })
  name: string;

  /** 角色定位,如"法务顾问""HR 政策客服" */
  @Column({ length: 128, default: '企业知识助手' })
  role: string;

  /** 性格描述,如"耐心、专业、语气亲切" */
  @Column({ type: 'text', default: '' })
  personality: string;

  /** 可以回答的问题范围(自然语言描述) */
  @Column({ type: 'text', default: '' })
  allowedTopics: string;

  /** 不可以回答的问题范围 */
  @Column({ type: 'text', default: '' })
  deniedTopics: string;

  /** 优先从知识库检索,无答案后再由 AI 自由回答 */
  @Column({ type: 'boolean', default: true })
  retrievalFirst: boolean;

  /** 关联知识库 */
  @Column({ type: 'jsonb', nullable: true })
  kbIds: string[] | null;

  @Column({ type: 'text', default: '' })
  greeting: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  defaultModelId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
