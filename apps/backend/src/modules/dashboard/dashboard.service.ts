import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Team } from '../teams/entities/team.entity';
import { Document } from '../documents/entities/document.entity';
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { Assistant } from '../assistants/entities/assistant.entity';

/** 运营数据大屏聚合服务 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Team) private teamRepo: Repository<Team>,
    @InjectRepository(Document) private docRepo: Repository<Document>,
    @InjectRepository(KnowledgeBase) private kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(ChatMessage) private msgRepo: Repository<ChatMessage>,
    @InjectRepository(Assistant) private assistantRepo: Repository<Assistant>,
  ) {}

  async overview() {
    const [users, teams, docs, kbs, messages, assistants, avg] = await Promise.all([
      this.userRepo.count(),
      this.teamRepo.count(),
      this.docRepo.count({ where: { docType: 'doc' } }),
      this.kbRepo.count(),
      this.msgRepo.count({ where: { role: 'user' } }),
      this.assistantRepo.count(),
      this.msgRepo
        .createQueryBuilder('m')
        .select('COALESCE(AVG(m."latencyMs"),0)', 'avg')
        .where('m.role = :role AND m."latencyMs" IS NOT NULL', { role: 'assistant' })
        .getRawOne(),
    ]);
    return {
      users,
      teams,
      docs,
      kbs,
      messages,
      assistants,
      avgLatencyMs: Math.round(Number(avg?.avg ?? 0)),
    };
  }

  /** 近 N 天问答量趋势(generate_series 零填充,无消息的日期也返回 0) */
  async messagesTrend(days = 14) {
    const n = Math.min(Math.max(Number(days) || 14, 1), 90);
    const rows: any[] = await this.msgRepo.query(
      `SELECT to_char(g.d, 'MM-DD') AS day,
              COUNT(m.id) FILTER (WHERE m.role = 'user') AS "userCnt",
              COUNT(m.id) FILTER (WHERE m.role = 'assistant') AS "assistantCnt"
       FROM generate_series(
         date_trunc('day', NOW()) - (($1::int - 1) * interval '1 day'),
         date_trunc('day', NOW()),
         interval '1 day'
       ) AS g(d)
       LEFT JOIN chat_messages m ON date_trunc('day', m."createdAt") = g.d
       GROUP BY g.d
       ORDER BY g.d`,
      [n],
    );
    return rows.map((r) => ({
      day: r.day,
      userCnt: Number(r.userCnt ?? 0),
      assistantCnt: Number(r.assistantCnt ?? 0),
    }));
  }

  async teamDocs() {
    const rows = await this.docRepo
      .createQueryBuilder('d')
      // documents.teamId 为 varchar、teams.id 为 uuid,需显式转 text 才能 JOIN
      .innerJoin(Team, 't', `t.id::text = d."teamId"`)
      .select('t.name', 'team')
      .addSelect('COUNT(*)', 'docs')
      .where('d."docType" = :docType', { docType: 'doc' })
      .groupBy('t.name')
      .orderBy('docs', 'DESC')
      .getRawMany();
    return rows.map((r: any) => ({ team: r.team, docs: Number(r.docs) }));
  }

  async modelUsage() {
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m."modelId"', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('m.role = :role AND m."modelId" IS NOT NULL', { role: 'assistant' })
      .groupBy('m."modelId"')
      .getRawMany();
    return rows.map((r: any) => ({ model: r.model, count: Number(r.count) }));
  }

  /** 高频提问 TOP10 */
  async topQueries() {
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('SUBSTRING(m.content FROM 1 FOR 24)', 'query')
      .addSelect('COUNT(*)', 'count')
      .where('m.role = :role', { role: 'user' })
      .groupBy('SUBSTRING(m.content FROM 1 FOR 24)')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();
    return rows.map((r: any) => ({ query: r.query, count: Number(r.count) }));
  }
}
