import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { WechatService } from './wechat.service';
import {
  AdminLoginRequest,
  WechatRegisterRequest,
  WechatLoginRequest,
  LoginResponse,
  Role,
  UserStatus,
} from '@biz-reporting/shared-types';

/**
 * Auth 核心服务
 *
 * 三端认证：
 * 1. admin-login: username + password_hash 对比 → JWT
 * 2. wechat-register: wx.code → openid → 创建 city_user → JWT
 * 3. wechat-login: wx.code → openid → 查找已有用户 → JWT
 *
 * 微信 code2session：
 * - 配置 WECHAT_APPID + WECHAT_SECRET → 真实微信接口
 * - 未配置 → 自动降级 mock 模式（本地开发用）
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly wechatService: WechatService,
  ) {}

  /**
   * 管理员密码登录
   */
  async adminLogin(dto: AdminLoginRequest): Promise<LoginResponse> {
    const user = await this.usersService.findByUsername(dto.username);

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.role !== Role.SYSTEM_ADMIN) {
      throw new UnauthorizedException('该账号非管理员');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash!);
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 更新最后登录时间
    await this.usersService.updateLastLogin(user.id);

    return this.buildTokenResponse(user);
  }

  /**
   * 微信用户注册（首次登录自动创建）
   */
  async wechatRegister(dto: WechatRegisterRequest): Promise<LoginResponse> {
    const openid = await this.wechatService.code2Session(dto.code);

    // 检查是否已存在
    const existing = await this.usersService.findByOpenid(openid);
    if (existing) {
      // 已存在则直接返回 token（兼容重复点击注册）
      return this.buildTokenResponse(existing);
    }

    const user = await this.usersService.createCityUser({
      name: dto.name,
      openid,
      cityId: dto.cityId,
    });

    return this.buildTokenResponse(user);
  }

  /**
   * 微信用户登录（已有账号）
   */
  async wechatLogin(dto: WechatLoginRequest): Promise<LoginResponse> {
    const openid = await this.wechatService.code2Session(dto.code);

    const user = await this.usersService.findByOpenid(openid);
    if (!user) {
      throw new NotFoundException('用户不存在，请先调用注册接口');
    }

    if (user.status !== UserStatus.ENABLED) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    if (user.role === Role.CITY_USER && !user.cityId) {
      throw new UnauthorizedException('当前账号未绑定城市，请联系管理员');
    }

    // 更新最后登录时间
    await this.usersService.updateLastLogin(user.id);

    return this.buildTokenResponse(user);
  }

  /**
   * 验证 JWT payload 中的用户是否仍然有效
   */
  async validateUser(userId: number) {
    return this.usersService.findById(userId);
  }

  /**
   * 构建统一登录响应
   */
  private buildTokenResponse(user: import('@biz-reporting/shared-types').User): LoginResponse {
    const payload = {
      sub: user.id,
      role: user.role,
      cityId: user.cityId,
    };

    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        cityId: user.cityId,
      },
    };
  }
}
