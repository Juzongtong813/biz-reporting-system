import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { JWT_CONFIG } from '@biz-reporting/shared-constants';

/**
 * JWT 认证策略
 *
 * 从 Authorization: Bearer <token> 中提取并验证 JWT
 * payload 格式: { sub: userId, role: Role, cityId?: number }
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'biz-reporting-jwt-secret-change-in-production',
    });
  }

  async validate(payload: { sub: number; role: string; cityId?: number }) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }

    if (user.status !== 'enabled') {
      throw new UnauthorizedException('账号已被禁用');
    }

    return {
      userId: user.id,
      role: user.role,
      cityId: user.cityId,
    };
  }
}
