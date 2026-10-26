import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('chat_messages')
@Index(['sessionId'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  /** user / assistant / tool */
  @Column({ type: 'varchar', length: 16 })
  role: 'user' | 'assistant' | 'tool';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  modelId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  sources: any[] | null;

  @Column({ type: 'jsonb', nullable: true })
  toolCalls: any[] | null;

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
