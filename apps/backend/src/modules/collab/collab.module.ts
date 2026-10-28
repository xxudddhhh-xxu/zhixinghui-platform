import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/entities/document.entity';
import { DocumentVersion } from '../documents/entities/document-version.entity';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { CollabGateway } from './collab.gateway';
import { CollabService } from './collab.service';

/** 多人实时协同编辑:WebSocket 网关 + 房间权威 Y.Doc(JwtService/Redis/权限快照均为全局模块直接注入) */
@Module({
  imports: [TypeOrmModule.forFeature([Document, DocumentVersion]), UsersModule, AuditModule],
  providers: [CollabGateway, CollabService],
  exports: [CollabService],
})
export class CollabModule {}
