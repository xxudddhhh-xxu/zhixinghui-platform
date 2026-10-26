import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AssistantsModule } from '../assistants/assistants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage]),
    KnowledgeModule,
    AssistantsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
