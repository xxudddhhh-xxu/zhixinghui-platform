import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { sanitizeFilename } from '../../common/utils/filename.util';
import { RagClient } from '../knowledge/rag-client';

export class CreateDocDto {
  @IsUUID()
  teamId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsIn(['folder', 'doc'])
  docType?: 'folder' | 'doc';

  @IsOptional()
  @IsString()
  content?: string;
}

export class UpdateDocDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  /** 客户端持有的版本号,用于并发冲突检测 */
  @IsInt()
  version: number;
}

export class SetDocMemberDto {
  @IsUUID()
  userId: string;

  @IsIn(['editor', 'viewer', ''])
  role: 'editor' | 'viewer' | '';
}

const TEXT_EXT = /\.(txt|md|markdown)$/i;

@Controller('documents')
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private ragClient: RagClient,
  ) {}

  /** 懒加载子节点(前端文档树按需展开) */
  @Get()
  children(
    @CurrentUser() user,
    @Query('teamId') teamId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.documentsService.children(user, teamId, parentId || null);
  }

  @Get(':id')
  @RequirePermission({ type: 'document', action: 'read', source: 'param' })
  detail(@CurrentUser() user, @Param('id') id: string) {
    return this.documentsService.detail(user, id);
  }

  @Post()
  @RequirePermission({ type: 'team', action: 'write', source: 'body', field: 'teamId' })
  create(@CurrentUser() user, @Body() dto: CreateDocDto) {
    return this.documentsService.create(user, dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermission({ type: 'team', action: 'write', source: 'body', field: 'teamId' })
  @RateLimit({ name: 'doc:upload', limit: 30, windowSec: 600 })
  async upload(
    @CurrentUser() user,
    @Body('teamId') teamId: string,
    @Body('parentId') parentId: string | null | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('请选择要上传的文件');
    const filename = sanitizeFilename(file.originalname);
    let text: string;
    if (TEXT_EXT.test(filename)) {
      text = file.buffer.toString('utf-8');
    } else {
      // pdf/docx 交给 Python 服务解析
      text = await this.ragClient.parseFile(file.buffer, filename);
    }
    return this.documentsService.createFromFile(
      user,
      teamId,
      parentId || null,
      filename,
      text,
    );
  }

  @Patch(':id')
  @RequirePermission({ type: 'document', action: 'write', source: 'param' })
  update(@CurrentUser() user, @Param('id') id: string, @Body() dto: UpdateDocDto) {
    return this.documentsService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermission({ type: 'document', action: 'manage', source: 'param' })
  remove(@CurrentUser() user, @Param('id') id: string) {
    return this.documentsService.remove(user, id);
  }

  @Post(':id/move')
  @RequirePermission({ type: 'document', action: 'manage', source: 'param' })
  move(
    @CurrentUser() user,
    @Param('id') id: string,
    @Body('parentId') parentId: string | null,
  ) {
    return this.documentsService.move(user, id, parentId ?? null);
  }

  @Get(':id/versions')
  @RequirePermission({ type: 'document', action: 'read', source: 'param' })
  versions(@CurrentUser() user, @Param('id') id: string) {
    return this.documentsService.versions(user, id);
  }

  @Post(':id/versions/:version/restore')
  @RequirePermission({ type: 'document', action: 'write', source: 'param' })
  restore(@CurrentUser() user, @Param('id') id: string, @Param('version') version: number) {
    return this.documentsService.restoreVersion(user, id, Number(version));
  }

  @Get(':id/members')
  @RequirePermission({ type: 'document', action: 'manage', source: 'param' })
  listMembers(@CurrentUser() user, @Param('id') id: string) {
    return this.documentsService.listDocMembers(user, id);
  }

  @Post(':id/members')
  @RequirePermission({ type: 'document', action: 'manage', source: 'param' })
  setMember(@CurrentUser() user, @Param('id') id: string, @Body() dto: SetDocMemberDto) {
    return this.documentsService.setDocMember(user, id, dto.userId, dto.role || null);
  }

  /** 公开文档(ISR 渲染数据,匿名) */
  @Public()
  @Get(':id/public')
  publicDetail(@Param('id') id: string) {
    return this.documentsService.publicDetail(id);
  }
}
