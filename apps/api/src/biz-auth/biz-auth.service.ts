import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import {
  LoginSecurityService,
  LoginSecurityContext,
  LoginSecurityBlockedError,
} from '../auth/login-security.service';

/** 预计算 dummy bcrypt hash：账号不存在也执行 compare，避免时序侧信道（与旧 auth 一致） */
const DUMMY_PASSWORD_HASH = '$2a$10$5z8kiAlKpCdQasH2zEg4tuDz2lo/eGR6X2e4A.so51npXIU2SHAPe';

export interface BizLoginRequest {
  username: string;
  password: string;
}

export interface BizLoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    name: string;
    roleCode: string;
    cityId: string | null;
    sensitiveOrderScope: string;
  };
}

/**
 * biz 账号登录服务（新基线）
 * 与旧 AuthService 并存（旧体系零破坏）；复用 LoginSecurityService（HMAC 哈希桶 + 5 次失败锁 15 分钟）。
 */
@Injectable()
export class BizAuthService {
  constructor(
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    private readonly jwtService: JwtService,
    private readonly loginSecurity: LoginSecurityService,
    private readonly rbac: RbacService,
  ) {}

  async login(dto: BizLoginRequest, context?: LoginSecurityContext): Promise<BizLoginResponse> {
    const route = 'biz_login' as const;
    const subject = dto.username.trim();
    const ctx = context ?? { ip: 'unknown', requestId: 'unknown' };

    try {
      await this.loginSecurity.assertAllowed(route, subject);
    } catch (error) {
      if (error instanceof LoginSecurityBlockedError) {
        await this.loginSecurity.recordFailure({
          route, subject, context: ctx, outcome: 'blocked', reasonCode: 'ACCOUNT_RATE_BLOCKED',
        });
        throw new UnauthorizedException('账号已锁定，请 15 分钟后再试');
      }
      throw error;
    }

    const user = await this.userRepo.findOne({
      where: { username: subject },
      select: ['id', 'username', 'passwordHash', 'name', 'roleCode', 'cityId', 'status', 'authVersion', 'sensitiveOrderScope', 'mustChangePassword'],
    });
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    const allowed =
      !!user &&
      user.status === 'enabled' &&
      isPasswordValid;

    if (!allowed) {
      await this.loginSecurity.recordFailure({
        route, subject, context: ctx, outcome: 'failed', reasonCode: 'BAD_CREDENTIALS',
        userId: user?.id ?? null,
      });
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.loginSecurity.recordSuccess({
      route, subject, context: ctx, outcome: 'success', reasonCode: 'OK',
      userId: user.id,
    });

    const accessToken = this.jwtService.sign({
      sub: user.id,
      kind: 'biz',
      authVersion: user.authVersion,
    });
    const expiresIn = Number(process.env.JWT_EXPIRES_IN?.replace(/h$/, '') ?? 8) * 3600;

    return {
      accessToken,
      expiresIn,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roleCode: user.roleCode,
        cityId: user.cityId,
        sensitiveOrderScope: user.sensitiveOrderScope,
      },
    };
  }

  /** 当前登录用户信息（含权限码与数据范围，前端菜单/路由共用） */
  async me(ctx: BizAuthContext): Promise<{
    id: string;
    username: string;
    roleCode: string;
    cityId: string | null;
    sensitiveOrderScope: string;
    permissions: string[];
    dataScope: { scopeType: string; provinceIds: string[]; cityId: string | null };
  }> {
    return {
      id: ctx.userId,
      username: ctx.username,
      roleCode: ctx.roleCode,
      cityId: ctx.cityId,
      sensitiveOrderScope: ctx.sensitiveOrderScope,
      permissions: ctx.isSuperAdmin ? ['*'] : Array.from(ctx.permissionCodes),
      dataScope: ctx.dataScope,
    };
  }
}
