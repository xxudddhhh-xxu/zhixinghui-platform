import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { JWT_SECRET } from '../../common/constants/jwt';

export interface JwtPayload {
  sub: string;
  username: string;
}

/** 校验 JWT payload 并返回挂到 request.user 上的用户信息(协同网关握手复用同一逻辑) */
export async function validateJwtPayload(
  usersService: UsersService,
  payload: JwtPayload,
) {
  const user = await usersService.findById(payload.sub).catch(() => null);
  if (!user) throw new UnauthorizedException('用户不存在');
  if (user.status === 'disabled') throw new UnauthorizedException('账号已停用');
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    globalRole: user.globalRole,
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    return validateJwtPayload(this.usersService, payload);
  }
}
