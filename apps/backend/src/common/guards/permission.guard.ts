import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PERM_META_KEY, PermRequirement } from '../decorators/permissions.decorator';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { PermissionCacheService } from '../../infra/permission-cache.service';
import {
  actionSatisfies,
  effectiveDocAction,
  PermAction,
  TeamRole,
  DocRole,
} from '../utils/permission.util';
import { Document } from '../../modules/documents/entities/document.entity';
import { KnowledgeBase } from '../../modules/knowledge/entities/knowledge-base.entity';

/**
 * 统一资源权限守卫(接口侧双重鉴权之一):
 * 解析 @RequirePermission 声明,基于"团队角色 + 文档级覆盖"计算有效权限。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private reflector: Reflector,
    private permCache: PermissionCacheService,
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,
    @InjectRepository(KnowledgeBase)
    private kbRepo: Repository<KnowledgeBase>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = this.reflector.getAllAndOverride<PermRequirement>(PERM_META_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!req) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;
    if (!user) return false;
    if (user.globalRole === 'admin') return true; // 平台管理员放行

    const resourceId =
      req.source === 'body' ? request.body?.[req.field ?? 'id'] : request.params?.[req.field ?? 'id'];
    if (!resourceId) return true; // 无资源 ID(如列表接口)交由业务层过滤

    switch (req.type) {
      case 'team':
        return this.checkTeam(user.id, resourceId, req.action);
      case 'document':
        return this.checkDocument(user.id, resourceId, req.action);
      case 'knowledge':
        return this.checkKnowledge(user.id, resourceId, req.action);
    }
  }

  private ok() {
    return true;
  }

  private async checkTeam(userId: string, teamId: string, action: PermAction) {
    const role = (await this.permCache.teamRole(userId, teamId)) as TeamRole | null;
    if (!role) throw new ForbiddenException('您不属于该团队,禁止访问');
    const eff = effectiveDocAction(role, null);
    if (!eff || !actionSatisfies(eff, action))
      throw new ForbiddenException('团队角色权限不足');
    return this.ok();
  }

  private async checkDocument(userId: string, docId: string, action: PermAction) {
    const doc = await this.documentRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    const [teamRole, docRole] = await Promise.all([
      this.permCache.teamRole(userId, doc.teamId),
      this.permCache.docRole(userId, docId),
    ]);
    const eff = effectiveDocAction(teamRole as TeamRole | null, docRole as DocRole | null);
    if (!eff) throw new ForbiddenException('无该文档访问权限(跨团队资源隔离)');
    if (!actionSatisfies(eff, action)) throw new ForbiddenException('文档操作权限不足');
    return this.ok();
  }

  private async checkKnowledge(userId: string, kbId: string, action: PermAction) {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    const role = (await this.permCache.teamRole(userId, kb.teamId)) as TeamRole | null;
    const eff = effectiveDocAction(role, null);
    if (!eff) throw new ForbiddenException('无该知识库访问权限');
    if (!actionSatisfies(eff, action)) throw new ForbiddenException('知识库操作权限不足');
    return this.ok();
  }
}
