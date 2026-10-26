import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /** 用户列表(仅平台管理员,业务层校验) */
  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('q') q: string,
    @CurrentUser('globalRole') globalRole: string,
  ) {
    if (globalRole !== 'admin') {
      return { items: [], total: 0, page, pageSize, adminOnly: true };
    }
    return this.usersService.list({ page, pageSize, q });
  }

  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body('status') status: 'active' | 'disabled',
    @CurrentUser('id') operatorId: string,
    @CurrentUser('globalRole') globalRole: string,
  ) {
    if (globalRole !== 'admin') throw new ForbiddenException('仅平台管理员可操作');
    if (id === operatorId) throw new ForbiddenException('不能停用自己的账号');
    return this.usersService.setStatus(id, status);
  }
}
