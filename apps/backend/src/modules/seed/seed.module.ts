import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Document } from '../documents/entities/document.entity';
import { Assistant } from '../assistants/entities/assistant.entity';
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Team, TeamMember, Document, Assistant, KnowledgeBase]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
