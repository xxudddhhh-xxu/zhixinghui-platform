import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 知识库文档条目(已入库的来源,向量存于 Qdrant,此表记录元信息) */
@Entity('kb_documents')
@Index(['kbId'])
export class KbDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  kbId: string;

  /** 来源团队文档 ID(文件上传入库时为空) */
  @Column({ type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ length: 200 })
  sourceName: string;

  @Column({ type: 'int', default: 0 })
  chunkCount: number;

  @Column({ length: 16, default: 'ready' })
  status: 'pending' | 'ready' | 'failed';

  @CreateDateColumn()
  createdAt: Date;
}
