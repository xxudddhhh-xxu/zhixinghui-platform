import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
@Index(['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 64 })
  username: string;

  @Column()
  password: string; // bcrypt 哈希

  @Column({ length: 64 })
  nickname: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  email: string | null;

  /** 平台角色: admin 平台管理员 / user 普通用户 */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  globalRole: 'admin' | 'user';

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'disabled';

  @CreateDateColumn()
  createdAt: Date;
}
