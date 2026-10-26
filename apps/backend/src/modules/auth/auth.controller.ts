import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { AuthService, LoginDto, RegisterDto } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionCacheService } from '../../infra/permission-cache.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private permCache: PermissionCacheService,
  ) {}

  @Public()
  @Post('login')
  @RateLimit({ name: 'auth:login', limit: 10, windowSec: 60, scope: 'ip' })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Public()
  @Post('register')
  @RateLimit({ name: 'auth:register', limit: 5, windowSec: 300, scope: 'ip' })
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(dto, ip);
  }

  /** 当前用户信息 + 权限快照(前端按钮显隐依据) */
  @Get('profile')
  profile(@CurrentUser() user) {
    return this.permCache.getSnapshot(user.id).then((snapshot) => ({
      user,
      permissions: snapshot,
    }));
  }
}
