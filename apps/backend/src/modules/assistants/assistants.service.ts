import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assistant } from './entities/assistant.entity';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AssistantsService {
  constructor(
    @InjectRepository(Assistant) private repo: Repository<Assistant>,
  ) {}

  /** 本人创建的助手(平台管理员可见全部) */
  async list(user: CurrentUserData) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.updatedAt', 'DESC');
    if (user.globalRole !== 'admin') qb.where('a.userId = :uid', { uid: user.id });
    return qb.getMany();
  }

  async findOne(id: string): Promise<Assistant> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('助手不存在');
    return a;
  }

  async create(user: CurrentUserData, dto: Partial<Assistant>) {
    return this.repo.save(
      this.repo.create({
        ...dto,
        userId: user.id,
        kbIds: dto.kbIds ?? [],
      }),
    );
  }

  async update(user: CurrentUserData, id: string, dto: Partial<Assistant>) {
    const a = await this.findOne(id);
    if (a.userId !== user.id && user.globalRole !== 'admin')
      throw new NotFoundException('助手不存在');
    await this.repo.update({ id }, dto);
    return this.findOne(id);
  }

  async remove(user: CurrentUserData, id: string) {
    const a = await this.findOne(id);
    if (a.userId !== user.id && user.globalRole !== 'admin')
      throw new NotFoundException('助手不存在');
    await this.repo.delete({ id });
    return true;
  }
}
