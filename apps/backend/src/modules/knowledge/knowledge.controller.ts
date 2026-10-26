import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { KnowledgeService } from './knowledge.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';

export class CreateKbDto {
  @IsString()
  teamId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class SearchDto {
  @IsArray()
  @IsString({ each: true })
  kbIds: string[];

  @IsString()
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledgeService: KnowledgeService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.knowledgeService.listMine(user);
  }

  @Post()
  @RequirePermission({ type: 'team', action: 'manage', source: 'body', field: 'teamId' })
  create(@CurrentUser() user, @Body() dto: CreateKbDto) {
    return this.knowledgeService.create(user, dto);
  }

  @Get(':id/docs')
  @RequirePermission({ type: 'knowledge', action: 'read', source: 'param', field: 'id' })
  listDocs(@CurrentUser() user, @Param('id') id: string) {
    return this.knowledgeService.listKbDocs(user, id);
  }

  @Post(':id/ingest-document')
  @RequirePermission({ type: 'knowledge', action: 'manage', source: 'param', field: 'id' })
  @RateLimit({ name: 'kb:ingest', limit: 30, windowSec: 600 })
  ingestDocument(
    @CurrentUser() user,
    @Param('id') id: string,
    @Body('documentId') documentId: string,
  ) {
    return this.knowledgeService.ingestDocument(user, id, documentId);
  }

  @Post(':id/upload')
  @RequirePermission({ type: 'knowledge', action: 'manage', source: 'param', field: 'id' })
  @UseInterceptors(FileInterceptor('file'))
  @RateLimit({ name: 'kb:upload', limit: 30, windowSec: 600 })
  upload(
    @CurrentUser() user,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('请选择要上传的文件');
    return this.knowledgeService.ingestFile(user, id, file);
  }

  @Delete(':id/docs/:recId')
  @RequirePermission({ type: 'knowledge', action: 'manage', source: 'param', field: 'id' })
  removeDoc(@CurrentUser() user, @Param('id') id: string, @Param('recId') recId: string) {
    return this.knowledgeService.removeKbDoc(user, id, recId);
  }

  /** 检索测试(RAG 链路验证) */
  @Post('search')
  @RateLimit({ name: 'kb:search', limit: 60, windowSec: 60 })
  search(@CurrentUser() user, @Body() dto: SearchDto) {
    return this.knowledgeService.search(user, dto.kbIds, dto.query, dto.topK ?? 5);
  }
}
