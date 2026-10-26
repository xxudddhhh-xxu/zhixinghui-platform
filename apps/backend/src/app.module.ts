import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from './infra/redis.module';
import { PermissionModule } from './infra/permission.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TeamsModule } from './modules/teams/teams.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { ChatModule } from './modules/chat/chat.module';
import { AssistantsModule } from './modules/assistants/assistants.module';
import { LlmModule } from './modules/llm/llm.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuditModule } from './modules/audit/audit.module';
import { SeedModule } from './modules/seed/seed.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { PermissionGuard } from './common/guards/permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: String(config.get('DB_HOST') ?? 'localhost'),
        port: Number(config.get('DB_PORT') ?? 5432),
        username: String(config.get('DB_USER') ?? 'postgres'),
        password: String(config.get('DB_PASSWORD') ?? 'postgres123'),
        database: String(config.get('DB_NAME') ?? 'zhixinghui'),
        // 云数据库(如 Supabase)要求 TLS:DB_SSL=true 时启用
        ssl: config.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: true, // 开发环境自动同步表结构
        logging: false,
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
    RedisModule,
    PermissionModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    DocumentsModule,
    KnowledgeModule,
    ChatModule,
    AssistantsModule,
    LlmModule,
    DashboardModule,
    AuditModule,
    SeedModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
