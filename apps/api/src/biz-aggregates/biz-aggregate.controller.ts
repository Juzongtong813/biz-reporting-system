import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService, RecalcScope } from './biz-aggregate.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 汇总/分析/设置 API（新基线 M6）
 * 汇总重算：super_admin/admin（operation.settings.manage 系权限缺失时以 contract/order 权限替代）
 */
@Controller('biz')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAggregateController {
  constructor(private readonly service: BizAggregateService) {}

  // ---- 汇总重算 ----
  @Post('aggregates/recalc')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async recalc(@BizAuthUser() auth: BizAuthContext, @Body() body: { scope?: RecalcScope; confirmAll?: boolean }) {
    const result = await this.service.recalc(auth, body?.scope ?? {}, Boolean(body?.confirmAll));
    return { ok: true, ...result };
  }

  @Get('aggregates/failures')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async failures(@BizAuthUser() auth: BizAuthContext) {
    return { items: await this.service.listFailures(auth) };
  }

  // ---- 一致性核对（只告警） ----
  @Post('aggregates/check')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async check(@BizAuthUser() auth: BizAuthContext) {
    const warnings = await this.service.checkConsistency(auth);
    return { ok: true, warnings, warningCount: warnings.length };
  }

  // ---- 分析聚合 ----
  @Get('analysis/overview')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async overview(@BizAuthUser() auth: BizAuthContext, @Query('month') month?: string, @Query('cityId') cityId?: string) {
    return this.service.overview(auth, month, cityId);
  }

  @Get('analysis/trend')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async trend(@BizAuthUser() auth: BizAuthContext, @Query('limit') limit?: string, @Query('cityId') cityId?: string) {
    return { items: await this.service.trend(auth, Number(limit) || 12, cityId) };
  }

  @Get('analysis/by-city')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async byCity(@BizAuthUser() auth: BizAuthContext, @Query('month') month?: string) {
    return { items: await this.service.byCity(auth, month) };
  }

  @Get('analysis/overrun-list')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async overrunList(@BizAuthUser() auth: BizAuthContext) {
    return { items: await this.service.overrunList(auth) };
  }

  // ---- 系统设置（DEV-055） ----
  @Get('settings')
  @BizPermissions(BizPermissionCode.OPERATION_SETTINGS_READ)
  async listSettings() {
    return { items: await this.service.listSettings() };
  }

  @Put('settings/:key')
  @BizPermissions(BizPermissionCode.OPERATION_SETTINGS_MANAGE)
  async updateSetting(@BizAuthUser() auth: BizAuthContext, @Param('key') key: string, @Body() body: { value: string }) {
    await this.service.updateSetting(auth, key, body.value);
    return { ok: true };
  }
}
