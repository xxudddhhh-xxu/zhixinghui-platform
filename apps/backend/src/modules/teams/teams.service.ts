import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Team } from './entities/team.entity';
import { TeamMember, TeamRoleType } from './entities/team-member.entity';
import { User } from '../users/entities/user.entity';
import { PermissionCacheService } from '../../infra/permission-cache.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private teamRepo: Repository<Team>,
    @InjectRepository(TeamMember) private memberRepo: Repository<TeamMember>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private permCache: PermissionCacheService,
    private audit: AuditService,
  ) {}

  /** 我所在的团队列表(含角色) */
  async myTeams(user: CurrentUserData) {
    if (user.globalRole === 'admin') {
      const teams = await this.teamRepo.find({ order: { createdAt: 'ASC' } });
      const members = await this.memberRepo.find();
      const roleOf = (teamId: string) =>
        members.find((m) => m.teamId === teamId)?.role ?? 'owner';
      return teams.map((t) => ({ ...t, myRole: roleOf(t.id) }));
    }
    const members = await this.memberRepo.find({
      where: { userId: user.id },
      relations: ['team'],
    });
    return members.map((m) => ({ ...m.team, myRole: m.role }));
  }

  async create(user: CurrentUserData, name: string, description?: string) {
    const team = await this.teamRepo.save(
      this.teamRepo.create({ name, description: description || null, ownerId: user.id }),
    );
    await this.memberRepo.save(
      this.memberRepo.create({ teamId: team.id, userId: user.id, role: 'owner' }),
    );
    await this.permCache.invalidate(user.id);
    await this.audit.log(user.id, user.username, 'TEAM_CREATE', `team:${team.id}`, { name });
    return team;
  }

  /** 成员需为团队 admin/owner 才能操作,业务层二次校验 */
  private async requireTeamManage(userId: string, globalRole: string, teamId: string) {
    if (globalRole === 'admin') return;
    const m = await this.memberRepo.findOne({ where: { teamId, userId } });
    if (!m || !['owner', 'admin'].includes(m.role))
      throw new ForbiddenException('仅团队管理员可管理成员');
  }

  async listMembers(operator: CurrentUserData, teamId: string) {
    await this.requireTeamManage(operator.id, operator.globalRole, teamId);
    const members = await this.memberRepo.find({
      where: { teamId },
      relations: ['user'],
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      username: m.user.username,
      nickname: m.user.nickname,
      email: m.user.email,
      status: m.user.status,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async addMember(operator: CurrentUserData, teamId: string, username: string, role: TeamRoleType) {
    await this.requireTeamManage(operator.id, operator.globalRole, teamId);
    const target = await this.userRepo.findOne({ where: { username } });
    if (!target) throw new NotFoundException('用户不存在');
    const exists = await this.memberRepo.findOne({ where: { teamId, userId: target.id } });
    if (exists) throw new BadRequestException('该用户已是团队成员');
    await this.memberRepo.save(this.memberRepo.create({ teamId, userId: target.id, role }));
    await this.permCache.invalidate(target.id);
    await this.audit.log(operator.id, operator.username, 'TEAM_MEMBER_ADD', `team:${teamId}`, {
      target: username,
      role,
    });
    return true;
  }

  async updateMemberRole(operator: CurrentUserData, teamId: string, userId: string, role: TeamRoleType) {
    await this.requireTeamManage(operator.id, operator.globalRole, teamId);
    const m = await this.memberRepo.findOne({ where: { teamId, userId } });
    if (!m) throw new NotFoundException('成员不存在');
    if (m.role === 'owner') throw new ForbiddenException('不能修改团队所有者角色');
    await this.memberRepo.update({ id: m.id }, { role });
    await this.permCache.invalidate(userId);
    await this.audit.log(operator.id, operator.username, 'TEAM_MEMBER_ROLE', `team:${teamId}`, {
      target: userId,
      role,
    });
    return true;
  }

  async removeMember(operator: CurrentUserData, teamId: string, userId: string) {
    await this.requireTeamManage(operator.id, operator.globalRole, teamId);
    const m = await this.memberRepo.findOne({ where: { teamId, userId } });
    if (!m) throw new NotFoundException('成员不存在');
    if (m.role === 'owner') throw new ForbiddenException('不能移除团队所有者');
    await this.memberRepo.delete({ id: m.id });
    await this.permCache.invalidate(userId);
    await this.audit.log(operator.id, operator.username, 'TEAM_MEMBER_REMOVE', `team:${teamId}`, {
      target: userId,
    });
    return true;
  }

  /** 候选用户(加成员时搜索,排除已在团队内的) */
  async candidateUsers(teamId: string, q: string) {
    const existing = await this.memberRepo.find({ where: { teamId }, select: ['userId'] });
    const ids = existing.map((m) => m.userId);
    const qb = this.userRepo.createQueryBuilder('u').where('u.status = :status', { status: 'active' });
    if (ids.length) qb.andWhere('u.id NOT IN (:...ids)', { ids });
    if (q) qb.andWhere('(u.username LIKE :q OR u.nickname LIKE :q)', { q: `%${q}%` });
    return qb.take(20).getMany();
  }
}
