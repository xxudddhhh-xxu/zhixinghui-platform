import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 文档级角色授权(两级权限模型的第二级,可跨团队单独授权) */
@Entity('document_members')
@Index(['documentId', 'userId'], { unique: true })
export class DocumentMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  role: 'editor' | 'viewer';

  @CreateDateColumn()
  createdAt: Date;
}
