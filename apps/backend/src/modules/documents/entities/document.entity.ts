import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DocType = 'folder' | 'doc';

@Entity('documents')
@Index(['teamId', 'parentId'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  teamId: string;

  /** 父节点,null 为根 */
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'varchar', length: 16, default: 'doc' })
  docType: DocType;

  /** 是否公开(公开文档可通过 ISR 页面匿名访问) */
  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  /** 乐观锁版本号,并发编辑冲突检测 */
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ nullable: true })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
