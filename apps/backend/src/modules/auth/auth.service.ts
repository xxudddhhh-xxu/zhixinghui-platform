import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { User } from '../users/entities/user.entity';
import { toSafeUser } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

export class LoginDto {
  @IsString()
  @MinLength(2)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  nickname: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  email?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip: string) {
    const user = await this.userRepo.findOne({ where: { username: dto.username } });
    const ok = user && (await bcrypt.compare(dto.password, user.password));
    if (!ok) {
      await this.audit.log(null, dto.username, 'LOGIN_FAILED', 'auth', { ip }, ip);
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status === 'disabled')
      throw new UnauthorizedException('账号已停用,请联系管理员');

    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
    });
    await this.audit.log(user.id, user.username, 'LOGIN', 'auth', { ip }, ip);
    return { token, user: toSafeUser(user) };
  }

  async register(dto: RegisterDto, ip: string) {
    const exists = await this.userRepo.findOne({
      where: { username: dto.username },
    });
    if (exists) throw new UnauthorizedException('用户名已存在');
    const user = this.userRepo.create({
      username: dto.username,
      password: await bcrypt.hash(dto.password, 10),
      nickname: dto.nickname,
      email: dto.email || null,
      globalRole: 'user',
    });
    const saved = await this.userRepo.save(user);
    await this.audit.log(saved.id, saved.username, 'REGISTER', 'auth', {}, ip);
    const token = this.jwtService.sign({ sub: saved.id, username: saved.username });
    return { token, user: toSafeUser(saved) };
  }
}
