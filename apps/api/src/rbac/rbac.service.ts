import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PlatformRole } from '@biz-reporting/shared-types';
import { PlatformUserEntity } from './platform-user.entity';
import { RoleEntity } from './role.entity';
import { RolePermissionEntity } from './role-permission.entity';
import { UserPermissionOverrideEntity } from './user-permission-override.entity';
import { UserDataScopeEntity } from './user-data-scope.entity';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';

/** super_admin 通配标记：拥有全部权限 */
export const SUPER_ADMIN_ALL = '*';

/** 解析后的用户数据范围 */
export interface ResolvedDataScope {
  /** all=全部省份/地市（super_admin）；province=按省；city=单地市；contract=仅合同域（contract_manager） */
  scopeType: 'all' | 'province' | 'city' | 'contract';
  /** scopeType=province 时允许的省份 UUID 列表；空=全部省份 */
  provinceIds: string[];
  /** scopeType=city 时绑定的地市 UUID */
  cityId: string | null;
}

/** 权限上下文（挂在 request.bizAuth 上，供守卫与服务使用） */
export interface BizAuthContext {
  userId: string;
  username: string;
  roleCode: PlatformRole;
  cityId: string | null;
  authVersion: number;
  sensitiveOrderScope: string;
  /** 权限码集合；isSuperAdmin=true 时忽略（通配 ALL） */
  permissionCodes: Set<string>;
  isSuperAdmin: boolean;
  dataScope: ResolvedDataScope;
}

/**
 * 权限服务（新基线）
 * 基线：01 §3.1 / 02 §1 —— "角色默认权限 + 账户级调整"合并；
 * super_admin 永久拥有全部权限；页面/API/导出三路共用本服务。
 */
@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly overrideRepo: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserDataScopeEntity)
    private readonly dataScopeRepo: Repository<UserDataScopeEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
  ) {}

  /** 加载用户完整权限上下文（角色默认 + 账号例外合并） */
  async loadUserAuthContext(userId: string): Promise<BizAuthContext> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.status !== 'enabled') throw new ForbiddenException('账号已被停用');

    const isSuperAdmin = user.roleCode === PlatformRole.SUPER_ADMIN;
    const dataScope = await this.resolveDataScope(user);

    let permissionCodes = new Set<string>();
    if (!isSuperAdmin) {
      // 1. 角色默认权限
      const role = await this.roleRepo.findOneBy({ code: user.roleCode });
      if (role) {
        const bindings = await this.rolePermissionRepo.findBy({ roleId: role.id });
        for (const binding of bindings) permissionCodes.add(binding.permissionCode);
      }
      // 2. 账号例外权限（allow 添加 / deny 移除）
      const overrides = await this.overrideRepo.findBy({ userId: user.id });
      for (const override of overrides) {
        if (override.effect === 'allow') permissionCodes.add(override.permissionCode);
        if (override.effect === 'deny') permissionCodes.delete(override.permissionCode);
      }
    }

    return {
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode as PlatformRole,
      cityId: user.cityId,
      authVersion: user.authVersion,
      sensitiveOrderScope: user.sensitiveOrderScope,
      permissionCodes,
      isSuperAdmin,
      dataScope,
    };
  }

  /** 校验权限码（super_admin 通配） */
  assertPermission(ctx: BizAuthContext, code: string): void {
    if (ctx.isSuperAdmin || ctx.permissionCodes.has(code)) return;
    throw new ForbiddenException('权限不足');
  }

  /** 解析数据范围（基线 02 §5：范围来源固定，不信任请求参数） */
  private async resolveDataScope(user: PlatformUserEntity): Promise<ResolvedDataScope> {
    if (user.roleCode === PlatformRole.SUPER_ADMIN) {
      return { scopeType: 'all', provinceIds: [], cityId: null };
    }
    if (user.roleCode === PlatformRole.CONTRACT_MANAGER) {
      // 基线 02 §5 / M2 合约：contract_manager 无业务明细范围（仅合同对象范围）
      return { scopeType: 'contract', provinceIds: [], cityId: null };
    }
    if (user.roleCode === PlatformRole.CITY_USER) {
      if (!user.cityId) throw new ForbiddenException('地市用户未绑定地市');
      return { scopeType: 'city', provinceIds: [], cityId: user.cityId };
    }
    // admin：默认全部省份（data_scopes 为空 = 全部）；可被 super_admin 收窄
    const scopes = await this.dataScopeRepo.findBy({ userId: user.id });
    const provinceIds = scopes.map((scope) => scope.provinceId).filter((id): id is string => Boolean(id));
    if (scopes.some((scope) => scope.scopeType === 'all') || scopes.length === 0) {
      return { scopeType: 'province', provinceIds: [], cityId: null };
    }
    if (scopes.every((scope) => scope.cityId)) {
      const cityIds = scopes.map((scope) => scope.cityId).filter((id): id is string => Boolean(id));
      if (cityIds.length === 1) {
        return { scopeType: 'city', provinceIds: [], cityId: cityIds[0] };
      }
    }
    return { scopeType: 'province', provinceIds, cityId: null };
  }

  /** 校验请求中的省份参数在数据范围内 */
  async assertProvinceScope(ctx: BizAuthContext, provinceId: string | undefined | null): Promise<void> {
    if (!provinceId) return;
    if (ctx.isSuperAdmin) return;
    if (ctx.dataScope.scopeType === 'contract') throw new ForbiddenException('数据范围不足');
    if (ctx.dataScope.scopeType === 'city') {
      const city = await this.cityRepo.findOneBy({ id: ctx.dataScope.cityId ?? '' });
      if (!city || city.provinceId !== provinceId) throw new ForbiddenException('数据范围不足');
      return;
    }
    // province 级
    if (ctx.dataScope.provinceIds.length > 0 && !ctx.dataScope.provinceIds.includes(provinceId)) {
      throw new ForbiddenException('数据范围不足');
    }
  }

  /** 校验请求中的地市参数在数据范围内 */
  async assertCityScope(ctx: BizAuthContext, cityId: string | undefined | null): Promise<void> {
    if (!cityId) return;
    if (ctx.isSuperAdmin) return;
    if (ctx.dataScope.scopeType === 'contract') throw new ForbiddenException('数据范围不足');
    if (ctx.dataScope.scopeType === 'city') {
      // 地市用户只能使用绑定地市（基线 02 §5.1：不得通过参数扩展）
      if (ctx.dataScope.cityId !== cityId) throw new ForbiddenException('数据范围不足');
      return;
    }
    // admin province 级：校验地市属于允许的省份
    const city = await this.cityRepo.findOneBy({ id: cityId });
    if (!city) throw new ForbiddenException('数据范围不足');
    if (ctx.dataScope.provinceIds.length > 0 && !ctx.dataScope.provinceIds.includes(city.provinceId)) {
      throw new ForbiddenException('数据范围不足');
    }
  }

  /** 批量校验地市 ID 列表（全部必须在范围内） */
  async assertCityIdsScope(ctx: BizAuthContext, cityIds: string[]): Promise<void> {
    for (const cityId of cityIds) await this.assertCityScope(ctx, cityId);
  }
}
