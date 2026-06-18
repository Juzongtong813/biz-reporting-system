import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from './user.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { Role, UserStatus } from '@biz-reporting/shared-types';
import type {
  UserListItem,
  UserListResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';

export interface CreateCityUserInput {
  name: string;
  openid: string;
  cityId: number;
}

/** 含城市名称的用户详情（用于 GET /me 接口返回） */
export interface UserWithCityName extends Omit<UserEntity, 'passwordHash'> {
  cityName: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  /** 按 ID 查找用户（含 cityName 联表查询）*/
  async findById(id: number): Promise<UserWithCityName | null> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) return null;

    // 联查城市名称
    let cityName: string | null = null;
    if (user.cityId) {
      const city = await this.cityRepository.findOne({
        where: { id: user.cityId },
        select: ['name'],
      });
      if (city) cityName = city.name;
    }

    const { passwordHash: _pwd, ...rest } = user;
    return { ...rest, cityName };
  }

  /** 按用户名查找管理员 */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { username },
      select: ['id', 'role', 'name', 'cityId', 'username', 'passwordHash', 'status'], // 显式包含密码字段
    });
  }

  /** 按 openid 查找微信用户 */
  async findByOpenid(openid: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { openid } });
  }

  /** 创建城市用户（微信注册） */
  async createCityUser(input: CreateCityUserInput): Promise<UserEntity> {
    const user = this.userRepository.create({
      role: Role.CITY_USER,
      name: input.name,
      openid: input.openid,
      cityId: input.cityId,
      status: UserStatus.ENABLED,
    });

    return this.userRepository.save(user);
  }

  /** 更新最后登录时间 */
  async updateLastLogin(userId: number): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
    });
  }

  /**
   * 初始化种子管理员（仅当表中无管理员时执行）
   * TODO: 在 AppModule.onModuleInit 中调用一次
   */
  async seedAdminIfNeeded(): Promise<void> {
    const adminCount = await this.userRepository.count({
      where: { role: Role.SYSTEM_ADMIN },
    });

    if (adminCount > 0) return;

    const hashedPassword = await bcrypt.hash('admin123456', 10);

    const admin = this.userRepository.create({
      role: Role.SYSTEM_ADMIN,
      name: '系统管理员',
      username: 'admin',
      passwordHash: hashedPassword,
      status: UserStatus.ENABLED,
    });

    await this.userRepository.save(admin);
  }

  // ============================================================
  // Admin 用户管理方法
  // ============================================================

  /**
   * 分页查询用户列表（含城市名称 + role）
   */
  async list(params: PaginationParams): Promise<UserListResponse> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;

    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { id: 'ASC' },
    });

    const items: UserListItem[] = await Promise.all(
      users.map(async (u) => {
        let cityName: string | null = null;
        if (u.cityId) {
          const city = await this.cityRepository.findOne({
            where: { id: u.cityId },
            select: ['name'],
          });
          cityName = city?.name ?? null;
        }
        return {
          id: u.id,
          role: u.role,
          name: u.name,
          cityId: u.cityId,
          cityName,
          status: u.status,
          registerAt: u.registerAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        };
      }),
    );

    return { items, total, page, pageSize };
  }

  /**
   * 更新用户状态（启用/禁用）
   */
  async updateStatus(
    userId: number,
    status: UserStatus,
  ): Promise<UserListItem> {
    await this.userRepository.update(userId, { status });
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException(`用户 #${userId} 不存在`);
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      cityId: user.cityId,
      cityName: user.cityName,
      status: user.status,
      registerAt: user.registerAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * 重新绑定城市用户到其他城市
   */
  async rebindCity(userId: number, cityId: number, operatorUserId: number): Promise<UserListItem> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`用户 #${userId} 不存在`);
    if (user.role !== Role.CITY_USER) {
      throw new BadRequestException('仅城市用户可重新绑定城市');
    }

    const oldCityId = user.cityId;
    let oldCityName: string | null = null;
    if (oldCityId) {
      const oldCity = await this.cityRepository.findOne({ where: { id: oldCityId }, select: ['name'] });
      oldCityName = oldCity?.name ?? null;
    }

    await this.userRepository.update(userId, { cityId });
    const updated = await this.findById(userId);
    if (!updated) throw new NotFoundException(`用户 #${userId} 不存在`);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId,
        actionType: 'user_rebind_city',
        targetType: 'user',
        targetId: String(userId),
        summaryText: `管理员将用户 ${user.name} 从城市 ${oldCityName ?? oldCityId ?? '无'} 改绑至城市 ${updated.cityName}`,
        beforeDataJson: { cityId: oldCityId, cityName: oldCityName },
        afterDataJson: { cityId: updated.cityId, cityName: updated.cityName },
        resultStatus: 'success',
      }),
    );

    return {
      id: updated.id,
      role: updated.role,
      name: updated.name,
      cityId: updated.cityId,
      cityName: updated.cityName,
      status: updated.status,
      registerAt: updated.registerAt.toISOString(),
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
    };
  }
}
