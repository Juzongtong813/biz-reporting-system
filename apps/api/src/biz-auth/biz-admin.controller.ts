import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from './biz-auth.guard';
import { BizPermissionsGuard } from './biz-permissions.guard';
import { BizPermissions } from './biz-permissions.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { BizAuthUser } from './biz-auth-user.decorator';
import { BizAdminService, CreateUserDto, PermissionOverrideInput, DataScopeInput } from './biz-admin.service';
import { BizPermissionCode, PlatformRole } from '@biz-reporting/shared-types';

/**
 * 账号与权限管理 API（新基线，仅 super_admin；基线 02 TABLE 3）
 * 停用/重置密码 → authVersion+1 使旧会话立即失效；权限变更在账号下次登录时生效。
 */
@Controller('biz/admin')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAdminController {
  constructor(
    private readonly adminService: BizAdminService,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
  ) {}

  // ---- 用户 ----
  @Get('users')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async listUsers(@BizAuthUser() auth: BizAuthContext) {
    const users = await this.adminService.listUsers();
    return {
      items: users.map(({ passwordHash: _ph, ...user }) => user),
    };
  }

  @Post('users')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async createUser(@BizAuthUser() auth: BizAuthContext, @Body() dto: CreateUserDto) {
    const user = await this.adminService.createUser(auth.userId, dto);
    const { passwordHash: _ph, ...rest } = user;
    return rest;
  }

  @Patch('users/:id/status')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async setUserStatus(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { status: 'enabled' | 'disabled' },
  ) {
    return this.adminService.setUserStatus(auth.userId, userId, body.status);
  }

  @Post('users/:id/reset-password')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async resetPassword(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { newPassword: string },
  ) {
    if (!body.newPassword || body.newPassword.length < 6) {
      return { ok: false, error: '密码最低 6 位' };
    }
    await this.adminService.resetPassword(auth.userId, userId, body.newPassword);
    return { ok: true };
  }

  @Get('users/:id/permissions')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async getUserPermissions(@Param('id') userId: string) {
    return this.adminService.getUserEffectivePermissions(userId);
  }

  @Put('users/:id/permission-overrides')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async setOverrides(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { overrides: PermissionOverrideInput[] },
  ) {
    await this.adminService.setPermissionOverrides(auth.userId, userId, body.overrides ?? []);
    return { ok: true };
  }

  @Put('users/:id/data-scopes')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async setDataScopes(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { scopes: DataScopeInput[] },
  ) {
    await this.adminService.setDataScopes(auth.userId, userId, body.scopes ?? []);
    return { ok: true };
  }

  // ---- 字典 ----
  // M8（DEV-066）：操作审计日志（super_admin/admin）
  @Get('operation-logs')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async operationLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('actionType') actionType?: string,
    @Query('targetType') targetType?: string,
    @Query('operatorUserId') operatorUserId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const currentPage = Math.max(1, Number(page) || 1);
    const currentPageSize = Math.min(100, Math.max(1, Number(pageSize) || Math.min(Number(limit) || 20, 100)));
    const qb = this.opLogRepo.createQueryBuilder('l')
      .leftJoin('biz_users', 'u', 'u.id = l.operator_user_id')
      .leftJoin('biz_cities', 'c', 'c.id = u.city_id')
      .select([
        'l.id AS id',
        'l.operator_user_id AS operatorUserId',
        'l.action_type AS actionType',
        'l.target_type AS targetType',
        'l.target_id AS targetId',
        'l.result_status AS resultStatus',
        'l.summary_before AS summaryBefore',
        'l.summary_after AS summaryAfter',
        'l.batch_id AS batchId',
        'l.error_message AS errorMessage',
        'l.created_at AS createdAt',
        'u.username AS username',
        'u.name AS operatorName',
        'u.role_code AS roleCode',
        'u.city_id AS cityId',
        'c.name AS cityName',
      ])
      .where('u.role_code <> :superRole', { superRole: 'super_admin' });
    if (actionType) qb.andWhere('l.action_type = :actionType', { actionType });
    if (targetType) qb.andWhere('l.target_type = :targetType', { targetType });
    if (operatorUserId) qb.andWhere('l.operator_user_id = :operatorUserId', { operatorUserId });
    if (dateFrom) qb.andWhere('l.created_at >= :dateFrom', { dateFrom: new Date(dateFrom) });
    if (dateTo) qb.andWhere('l.created_at <= :dateTo', { dateTo: new Date(dateTo) });
    const total = await qb.getCount();
    const items = await qb
      .orderBy('l.created_at', 'DESC')
      .skip((currentPage - 1) * currentPageSize)
      .take(currentPageSize)
      .getRawMany();
    return { items, total, page: currentPage, pageSize: currentPageSize };
  }

  @Get('roles')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async roles() {
    return { items: await this.adminService.listRoles() };
  }

  @Get('modules')
  @BizPermissions(BizPermissionCode.OPERATION_MODULE_MANAGE)
  async modules() {
    return { items: await this.adminService.listModules() };
  }

  @Get('permissions')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async permissions() {
    return { items: await this.adminService.listPermissions() };
  }

  @Get('provinces')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async provinces() {
    return { items: await this.adminService.listProvinces() };
  }

  @Get('cities')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async cities(@Query('provinceId') provinceId?: string) {
    return { items: await this.adminService.listCities(provinceId) };
  }
}
