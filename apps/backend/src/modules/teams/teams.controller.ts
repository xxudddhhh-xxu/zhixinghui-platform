import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TeamsService } from './teams.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddMemberDto {
  @IsString()
  username: string;

  @IsIn(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}

export class UpdateMemberDto {
  @IsIn(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}

@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Get()
  myTeams(@CurrentUser() user) {
    return this.teamsService.myTeams(user);
  }

  @Post()
  @RateLimit({ name: 'team:create', limit: 10, windowSec: 3600 })
  create(@CurrentUser() user, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user, dto.name, dto.description);
  }

  @Get(':id/members')
  @RequirePermission({ type: 'team', action: 'manage', source: 'param', field: 'id' })
  listMembers(@CurrentUser() user, @Param('id') id: string) {
    return this.teamsService.listMembers(user, id);
  }

  @Get(':id/candidates')
  @RequirePermission({ type: 'team', action: 'manage', source: 'param', field: 'id' })
  candidates(@Param('id') id: string, @Query('q') q: string) {
    return this.teamsService.candidateUsers(id, q || '');
  }

  @Post(':id/members')
  @RequirePermission({ type: 'team', action: 'manage', source: 'param', field: 'id' })
  addMember(@CurrentUser() user, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.teamsService.addMember(user, id, dto.username, dto.role);
  }

  @Patch(':id/members/:userId')
  @RequirePermission({ type: 'team', action: 'manage', source: 'param', field: 'id' })
  updateMember(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.teamsService.updateMemberRole(user, id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @RequirePermission({ type: 'team', action: 'manage', source: 'param', field: 'id' })
  removeMember(
    @CurrentUser() user,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.teamsService.removeMember(user, id, userId);
  }
}
