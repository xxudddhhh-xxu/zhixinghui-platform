import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

export type SafeUser = Omit<User, 'password'>;
export const toSafeUser = (u: User): SafeUser => {
  const { password, ...rest } = u;
  return rest;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  async findById(id: string): Promise<SafeUser> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    return toSafeUser(u);
  }

  async list({ page = 1, pageSize = 20, q = '' }) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC');
    if (q) qb.andWhere('(u.username LIKE :q OR u.nickname LIKE :q)', { q: `%${q}%` });
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: items.map(toSafeUser), total, page, pageSize };
  }

  async setStatus(id: string, status: 'active' | 'disabled') {
    await this.userRepo.update({ id }, { status });
    return true;
  }
}
