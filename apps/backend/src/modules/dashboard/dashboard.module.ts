import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Team } from '../teams/entities/team.entity';
import { Document } from '../documents/entities/document.entity';
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { Assistant } from '../assistants/entities/assistant.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Team, Document, KnowledgeBase, ChatMessage, Assistant]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
