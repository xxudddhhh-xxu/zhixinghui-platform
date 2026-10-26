import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KbDocument } from './entities/kb-document.entity';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { RagClient } from './rag-client';
import { Document } from '../documents/entities/document.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, KbDocument, Document]), AuditModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, RagClient],
  exports: [KnowledgeService, RagClient],
})
export class KnowledgeModule {}
