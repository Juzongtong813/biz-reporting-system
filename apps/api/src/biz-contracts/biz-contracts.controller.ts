import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizScopeGuard } from '../biz-auth/biz-scope.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizScope } from '../biz-auth/biz-scope.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import {
  BizContractsService, CreateContractDto, UpdateContractDto, AllocationDto, FeeRateDto, VoidContractDto,
} from './biz-contracts.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 合同域 API（新基线）
 * 基线：01 §4 / 02 TABLE 4 —— 权限矩阵（read/create/update/void/allocate/allocate_cancel/rate/export）
 * 数据范围：@BizScope 守卫校验省份/地市参数；city_user 仅已分配本地市合同。
 */
@Controller('biz/contracts')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard, BizScopeGuard)
export class BizContractsController {
  constructor(private readonly service: BizContractsService) {}

  @Get()
  @BizScope()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async list(
    @BizAuthUser() auth: BizAuthContext,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.service.list(auth, { provinceId, cityId, status });
    return { items };
  }

  @Post()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_CREATE)
  async create(@BizAuthUser() auth: BizAuthContext, @Body() dto: CreateContractDto) {
    return this.service.create(auth, dto);
  }

  @Get(':id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async detail(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.detail(auth, id);
  }

  @Patch(':id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async update(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.service.update(auth, id, dto);
  }

  // ---- 状态机 ----
  @Post(':id/activate')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async activate(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.activate(auth, id);
  }

  @Post(':id/complete')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async complete(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.complete(auth, id);
  }

  @Post(':id/void')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_VOID)
  async voidContract(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: VoidContractDto) {
    return this.service.voidContract(auth, id, dto);
  }

  @Post(':id/restore')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_VOID)
  async restore(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.restore(auth, id);
  }

  @Post(':id/refresh-alerts')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async refreshAlerts(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    await this.service.refreshAlerts(auth, id);
    return { ok: true };
  }

  // ---- 地市分配 ----
  @Post(':id/allocations')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_ALLOCATE)
  async upsertAllocation(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: AllocationDto) {
    return this.service.upsertAllocation(auth, id, dto);
  }

  @Delete(':id/allocations/:cityId')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_ALLOCATE_CANCEL)
  async cancelAllocation(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Param('cityId') cityId: string) {
    await this.service.cancelAllocation(auth, id, cityId);
    return { ok: true };
  }

  // ---- 费率 ----
  @Get(':id/fee-rates')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async feeRates(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    const detail = await this.service.detail(auth, id);
    return { items: detail.feeRates };
  }

  @Post(':id/fee-rates')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async addFeeRate(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: FeeRateDto) {
    return this.service.addFeeRate(auth, id, dto);
  }

  @Get(':id/effective-rate')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async effectiveRate(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') id: string,
    @Query('cityId') cityId: string,
    @Query('month') month: string,
  ) {
    await this.service.detail(auth, id); // 可见性校验
    const rate = await this.service.getEffectiveRate(id, cityId, month);
    return { rate: rate ? { rateBp: rate.rateBp, effectiveMonth: rate.effectiveMonth } : null };
  }
}
