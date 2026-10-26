import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenException } from '@nestjs/common';

@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('logs')
  async logs(
    @CurrentUser('globalRole') globalRole: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('action') action: string,
    @Query('q') q: string,
  ) {
    if (globalRole !== 'admin') throw new ForbiddenException('仅平台管理员可查看审计日志');
    return this.auditService.list({ page, pageSize, action, q });
  }
}
