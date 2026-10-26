import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamMember } from '../modules/teams/entities/team-member.entity';
import { DocumentMember } from '../modules/documents/entities/document-member.entity';
import { Document } from '../modules/documents/entities/document.entity';
import { KnowledgeBase } from '../modules/knowledge/entities/knowledge-base.entity';
import { PermissionCacheService } from './permission-cache.service';

/** 全局权限模块: 快照服务 + 相关仓储,供各业务模块与全局守卫注入 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TeamMember, DocumentMember, Document, KnowledgeBase])],
  providers: [PermissionCacheService],
  exports: [TypeOrmModule, PermissionCacheService],
})
export class PermissionModule {}
