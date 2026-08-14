import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ContractStatus, ContractTag, VoidSummaryChoice, PlatformRole } from '@biz-reporting/shared-types';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizContractAlertEntity } from '../contracts/biz-contract-alert.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';

export interface CreateContractDto {
  contractNo: string;
  contractName: string;
  taxInclusiveAmountFen: number;
  taxExclusiveAmountFen?: number | null;
  provinceId: string;
  startDate?: string | null;
  endDate?: string | null;
  parentContractId?: string | null;
}

export interface UpdateContractDto {
  contractName?: string;
  taxInclusiveAmountFen?: number;
  taxExclusiveAmountFen?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AllocationDto {
  cityId: string;
  quotaFen: number;
}

export interface FeeRateDto {
  cityId: string;
  effectiveMonth: string; // YYYY-MM
  rateBp: number; // 整数基点
  changeReason?: string | null;
}

export interface VoidContractDto {
  summaryChoice: VoidSummaryChoice;
  reason: string;
}

/**
 * 合同域服务（新基线）
 * 基线：01 §4 / 03 / 04 §2-3 / 07 TABLE 4
 * 关键规则：
 *  - 合同号全局唯一；系统内部 UUID；金额整数分；
 *  - 草稿允许不完整；生效前补齐（编号/名称/含税金额>0/起止日期/已分配地市均有费率）；
 *  - 生效后合同额永久锁定（amountLocked），录错只能作废重建；
 *  - 状态机：draft → active → completed / voided；恢复仅 super_admin；
 *  - 地市分配：额度合计 ≤ 合同额；取消仅 super_admin；历史数据保留；
 *  - 费率：合同+地市+生效月份历史；按业务月份取快照；
 *  - 进度 = 有效完工（订单+已审核线下完工）÷ 合同额，允许 >100%；超额动态计算。
 */
@Injectable()
export class BizContractsService {
  constructor(
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocationRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    @InjectRepository(BizContractAlertEntity)
    private readonly alertRepo: Repository<BizContractAlertEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOfflineCompletionEntity)
    private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    private readonly rbac: RbacService,
  ) {}

  // ================= 基础 =================

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'contract', targetId, resultStatus,
    });
  }

  private async getContractOrFail(id: string): Promise<BizContractEntity> {
    const contract = await this.contractRepo.findOneBy({ id });
    if (!contract) throw new NotFoundException('合同不存在');
    return contract;
  }

  /** 地市用户可见性：仅已分配给绑定地市的合同 */
  private async assertContractVisible(auth: BizAuthContext, contractId: string): Promise<void> {
    if (auth.roleCode === PlatformRole.CITY_USER) {
      const alloc = await this.allocationRepo.findOneBy({ contractId, cityId: auth.dataScope.cityId ?? '', status: 'active' });
      if (!alloc) throw new ForbiddenException('数据范围不足');
    }
  }

  // ================= 列表与详情 =================

  /** 合同列表（按数据范围过滤；city_user 仅已分配本地市） */
  async list(auth: BizAuthContext, filter: { provinceId?: string; cityId?: string; status?: string }): Promise<BizContractEntity[]> {
    await this.rbac.assertProvinceScope(auth, filter.provinceId);
    if (filter.cityId) await this.rbac.assertCityScope(auth, filter.cityId);

    const query = this.contractRepo.createQueryBuilder('c');
    if (filter.status) query.andWhere('c.status = :status', { status: filter.status });
    if (filter.provinceId) query.andWhere('c.provinceId = :provinceId', { provinceId: filter.provinceId });

    if (auth.roleCode === PlatformRole.CITY_USER) {
      // 地市用户：只返回分配给本地市的合同
      query
        .innerJoin(BizContractCityAllocationEntity, 'a', 'a.contract_id = c.id AND a.city_id = :cityId AND a.status = :allocActive', {
          cityId: auth.dataScope.cityId ?? '', allocActive: 'active',
        })
        .distinct(true);
    } else if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      query.andWhere('c.provinceId IN (:...provinceIds)', { provinceIds: auth.dataScope.provinceIds });
    } else if (auth.dataScope.scopeType === 'city') {
      query
        .innerJoin(BizContractCityAllocationEntity, 'a', 'a.contract_id = c.id AND a.city_id = :cityId AND a.status = :allocActive', {
          cityId: auth.dataScope.cityId ?? '', allocActive: 'active',
        })
        .distinct(true);
    }
    // contract_manager（scopeType='contract'）与 super_admin（all）不加过滤
    return query.orderBy('c.createdAt', 'DESC').getMany();
  }

  /** 详情聚合（基础/分配/费率/进度/预警/来源汇总） */
  async detail(auth: BizAuthContext, id: string) {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, id);

    const allocations = await this.allocationRepo.findBy({ contractId: id });
    const feeRates = await this.feeRateRepo.findBy({ contractId: id });
    const alerts = await this.alertRepo.findBy({ contractId: id, currentStatus: 'active' });

    // 有效完工（订单未作废 + 线下完工已审核未作废）
    const orders = await this.orderRowRepo.findBy({ contractId: id, isVoid: false });
    const offlines = await this.offlineRepo.findBy({ contractId: id, status: 'approved' });
    const orderCompletionFen = orders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0);
    const offlineCompletionFen = offlines.reduce((s, o) => s + Number(o.amountFen), 0);
    const totalCompletionFen = orderCompletionFen + offlineCompletionFen;
    const contractAmountFen = Number(contract.taxInclusiveAmountFen) || 0;
    const progress = contractAmountFen > 0 ? (totalCompletionFen / contractAmountFen) * 100 : 0;
    const overrunFen = Math.max(totalCompletionFen - contractAmountFen, 0);

    const cityRows = await Promise.all(allocations.map(async (alloc) => {
      const city = await this.cityRepo.findOneBy({ id: alloc.cityId });
      const cityOrders = orders.filter((o) => o.cityId === alloc.cityId);
      const cityOfflines = offlines.filter((o) => o.cityId === alloc.cityId);
      const cityCompletionFen =
        cityOrders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0) +
        cityOfflines.reduce((s, o) => s + Number(o.amountFen), 0);
      const cityQuota = Number(alloc.quotaFen) || 0;
      return {
        cityId: alloc.cityId,
        cityName: city?.name ?? alloc.cityId,
        quotaFen: cityQuota,
        status: alloc.status,
        effectiveAt: alloc.effectiveAt,
        completionFen: cityCompletionFen,
        progress: cityQuota > 0 ? (cityCompletionFen / cityQuota) * 100 : 0,
        overrunFen: Math.max(cityCompletionFen - cityQuota, 0),
        orderCompletionFen: cityOrders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0),
        offlineCompletionFen: cityOfflines.reduce((s, o) => s + Number(o.amountFen), 0),
      };
    }));

    return {
      contract: {
        id: contract.id,
        contractNo: contract.contractNo,
        contractName: contract.contractName,
        taxInclusiveAmountFen: Number(contract.taxInclusiveAmountFen),
        taxExclusiveAmountFen: contract.taxExclusiveAmountFen != null ? Number(contract.taxExclusiveAmountFen) : null,
        provinceId: contract.provinceId,
        startDate: contract.startDate,
        endDate: contract.endDate,
        status: contract.status,
        tags: contract.tags ?? [],
        amountLocked: contract.amountLocked,
        voidSummaryChoice: contract.voidSummaryChoice,
        parentContractId: contract.parentContractId,
        versionNo: contract.versionNo,
        createdAt: contract.createdAt,
      },
      allocations: cityRows,
      feeRates: feeRates.map((f) => ({ cityId: f.cityId, effectiveMonth: f.effectiveMonth, rateBp: f.rateBp, changeReason: f.changeReason })),
      alerts: alerts.map((a) => ({ alertType: a.alertType, firstTriggeredAt: a.firstTriggeredAt })),
      progress: {
        orderCompletionFen,
        offlineCompletionFen,
        totalCompletionFen,
        contractAmountFen,
        progress,
        remainingFen: contractAmountFen - totalCompletionFen,
        overrunFen,
      },
    };
  }

  // ================= 创建/编辑 =================

  async create(auth: BizAuthContext, dto: CreateContractDto): Promise<BizContractEntity> {
    const contractNo = dto.contractNo.trim();
    if (!contractNo) throw new BadRequestException('合同编号不能为空');
    const existing = await this.contractRepo.findOneBy({ contractNo });
    if (existing) throw new BadRequestException('合同编号已存在'); // CON-001 服务端唯一
    const province = await this.provinceRepo.findOneBy({ id: dto.provinceId });
    if (!province) throw new BadRequestException('省份不存在');
    if (dto.parentContractId) {
      const parent = await this.contractRepo.findOneBy({ id: dto.parentContractId });
      if (!parent) throw new BadRequestException('父合同不存在');
    }
    const contract = await this.contractRepo.save({
      id: randomUUID(),
      contractNo,
      contractName: dto.contractName,
      taxInclusiveAmountFen: Math.round(dto.taxInclusiveAmountFen),
      taxExclusiveAmountFen: dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null,
      provinceId: dto.provinceId,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      status: ContractStatus.DRAFT,
      amountLocked: false,
      parentContractId: dto.parentContractId ?? null,
      versionNo: 1,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await this.recordOp(auth.userId, 'contract.create', contract.id);
    return contract;
  }

  /** 编辑：草稿可改合同额；生效后合同额永久锁定（amountLocked=true 时拒绝金额修改） */
  async update(auth: BizAuthContext, id: string, dto: UpdateContractDto): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废，不可编辑');
    if (dto.taxInclusiveAmountFen !== undefined && contract.amountLocked) {
      throw new BadRequestException('合同生效后合同额永久锁定，不可修改（录错请作废重建）'); // CON-003
    }
    if (dto.taxInclusiveAmountFen !== undefined) contract.taxInclusiveAmountFen = Math.round(dto.taxInclusiveAmountFen);
    if (dto.taxExclusiveAmountFen !== undefined) contract.taxExclusiveAmountFen = dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null;
    if (dto.contractName !== undefined) contract.contractName = dto.contractName;
    if (dto.startDate !== undefined) contract.startDate = dto.startDate;
    if (dto.endDate !== undefined) contract.endDate = dto.endDate;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.update', id);
    return contract;
  }

  // ================= 状态机 =================

  /** 完整性校验：编号/名称/含税金额>0/起止日期/已分配地市均有费率 */
  private async assertCompleteness(contract: BizContractEntity): Promise<void> {
    const missing: string[] = [];
    if (!contract.contractNo?.trim()) missing.push('合同编号');
    if (!contract.contractName?.trim()) missing.push('合同名称');
    if (!Number(contract.taxInclusiveAmountFen) || Number(contract.taxInclusiveAmountFen) <= 0) missing.push('含税合同金额(>0)');
    if (!contract.startDate) missing.push('合同开始日期');
    if (!contract.endDate) missing.push('合同结束日期');
    if (missing.length) throw new BadRequestException(`合同资料不完整，缺少：${missing.join('、')}`);

    const allocations = await this.allocationRepo.findBy({ contractId: contract.id, status: 'active' });
    if (allocations.length === 0) throw new BadRequestException('合同资料不完整，缺少：地市分配');
    for (const alloc of allocations) {
      const rate = await this.feeRateRepo.findOneBy({
        contractId: contract.id, cityId: alloc.cityId,
      });
      if (!rate) throw new BadRequestException(`地市费率不完整，缺少：${alloc.cityId}`);
    }
  }

  /** 生效：draft → active；合同额锁定；versionNo++ */
  async activate(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    if (contract.status !== ContractStatus.DRAFT) throw new BadRequestException('仅草稿合同可生效');
    await this.assertCompleteness(contract);
    contract.status = ContractStatus.ACTIVE;
    contract.amountLocked = true; // 生效后合同额永久锁定
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.activate', id);
    return contract;
  }

  /** 确认完成：active → completed（进度必须 ≥100%，管理员确认） */
  async complete(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    if (contract.status !== ContractStatus.ACTIVE) throw new BadRequestException('仅执行中的合同可确认完成');
    const detail = await this.detail(auth, id);
    if (detail.progress.progress < 100) throw new BadRequestException('合同进度未达 100%，不可确认完成');
    contract.status = ContractStatus.COMPLETED;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.complete', id);
    return contract;
  }

  /** 作废：active/completed → voided；必填汇总口径与原因 */
  async voidContract(auth: BizAuthContext, id: string, dto: VoidContractDto): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    if (![ContractStatus.ACTIVE, ContractStatus.COMPLETED].includes(contract.status as ContractStatus)) {
      throw new BadRequestException('仅执行中或已完成的合同可作废');
    }
    if (!dto.summaryChoice || !dto.reason?.trim()) throw new BadRequestException('作废必须选择汇总口径并填写原因');
    contract.status = ContractStatus.VOIDED;
    contract.voidSummaryChoice = dto.summaryChoice;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.void', id);
    return contract;
  }

  /** 恢复已作废合同：voided → active（仅 super_admin；沿用原汇总选择，不自动恢复已取消分配） */
  async restore(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅 super_admin 可恢复合同');
    const contract = await this.getContractOrFail(id);
    if (contract.status !== ContractStatus.VOIDED) throw new BadRequestException('仅已作废合同可恢复');
    contract.status = ContractStatus.ACTIVE;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.restore', id);
    return contract;
  }

  // ================= 地市分配 =================

  /** 新增/调整分配：额度合计 ≤ 合同额；降低额度不得低于已生效完工金额（M5 起生效校验） */
  async upsertAllocation(auth: BizAuthContext, contractId: string, dto: AllocationDto): Promise<BizContractCityAllocationEntity> {
    const contract = await this.getContractOrFail(contractId);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废');
    const city = await this.cityRepo.findOneBy({ id: dto.cityId });
    if (!city) throw new BadRequestException('地市不存在');
    if (city.provinceId !== contract.provinceId) throw new BadRequestException('地市必须属于合同所属省份');

    const contractAmount = Number(contract.taxInclusiveAmountFen) || 0;
    const quotaFen = Math.round(dto.quotaFen);
    if (quotaFen < 0) throw new BadRequestException('地市额度不能为负数');

    const others = await this.allocationRepo.findBy({ contractId, status: 'active' });
    const existing = others.find((a) => a.cityId === dto.cityId);
    const otherTotal = others.filter((a) => a.cityId !== dto.cityId).reduce((s, a) => s + Number(a.quotaFen), 0);
    if (otherTotal + quotaFen > contractAmount) {
      throw new BadRequestException('各地市额度合计不得超过合同额'); // CON-006
    }
    if (existing) {
      if (quotaFen < Number(existing.quotaFen)) {
        // M5 起：不得降低到该地市已生效完工金额以下（此处预留，完工域接入后校验）
      }
      existing.quotaFen = quotaFen;
      existing.versionNo += 1;
      await this.allocationRepo.save(existing);
      await this.recordOp(auth.userId, 'contract.allocation.update', contractId);
      return existing;
    }
    const alloc = await this.allocationRepo.save({
      id: randomUUID(), contractId, cityId: dto.cityId, quotaFen,
      status: 'active', versionNo: 1,
    });
    await this.recordOp(auth.userId, 'contract.allocation.create', contractId);
    return alloc;
  }

  /** 取消分配：仅 super_admin（allocate_cancel 权限在守卫）；历史数据保留，禁止该地市新增业务 */
  async cancelAllocation(auth: BizAuthContext, contractId: string, cityId: string): Promise<void> {
    const contract = await this.getContractOrFail(contractId);
    const alloc = await this.allocationRepo.findOneBy({ contractId, cityId, status: 'active' });
    if (!alloc) throw new NotFoundException('分配不存在');
    alloc.status = 'cancelled';
    alloc.cancelledAt = new Date();
    alloc.versionNo += 1;
    await this.allocationRepo.save(alloc);
    await this.recordOp(auth.userId, 'contract.allocation.cancel', contractId);
  }

  // ================= 费率 =================

  /** 新增费率记录（合同+地市+生效月份唯一）；0 < rateBp ≤ 10000 */
  async addFeeRate(auth: BizAuthContext, contractId: string, dto: FeeRateDto): Promise<BizContractFeeRateEntity> {
    const contract = await this.getContractOrFail(contractId);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废');
    if (!/^\d{4}-\d{2}$/.test(dto.effectiveMonth)) throw new BadRequestException('生效月份格式应为 YYYY-MM');
    if (!Number.isInteger(dto.rateBp) || dto.rateBp <= 0 || dto.rateBp > 10000) {
      throw new BadRequestException('管理费率必须大于 0% 且不超过 100%');
    }
    const alloc = await this.allocationRepo.findOneBy({ contractId, cityId: dto.cityId });
    if (!alloc) throw new BadRequestException('费率地市必须先分配');
    const existing = await this.feeRateRepo.findOneBy({ contractId, cityId: dto.cityId, effectiveMonth: dto.effectiveMonth });
    if (existing) throw new BadRequestException('该合同+地市+生效月份费率已存在');
    const rate = await this.feeRateRepo.save({
      id: randomUUID(), contractId, cityId: dto.cityId,
      effectiveMonth: dto.effectiveMonth, rateBp: dto.rateBp,
      changeReason: dto.changeReason ?? null,
    });
    await this.recordOp(auth.userId, 'contract.fee_rate.create', contractId);
    return rate;
  }

  /** 生效费率快照：≤ 业务月份的最大生效月份费率（订单/完工入账时调用；历史完工不回溯） */
  async getEffectiveRate(contractId: string, cityId: string, businessMonth: string): Promise<BizContractFeeRateEntity | null> {
    const rates = await this.feeRateRepo
      .createQueryBuilder('f')
      .where('f.contractId = :contractId AND f.cityId = :cityId AND f.effectiveMonth <= :month', {
        contractId, cityId, month: businessMonth,
      })
      .orderBy('f.effectiveMonth', 'DESC')
      .getMany();
    return rates[0] ?? null;
  }

  // ================= 预警 =================

  /** 生成/更新合同预警（nearly_full / overfull / expiring / expired；简单实现，M6 收口完整回算） */
  async refreshAlerts(auth: BizAuthContext, contractId: string): Promise<void> {
    const contract = await this.getContractOrFail(contractId);
    const detail = await this.detail(auth, contractId);
    const tags: string[] = [];
    const progress = detail.progress.progress;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (progress >= 90 && progress < 100) tags.push(ContractTag.NEARLY_FULL);
    if (progress >= 100) {
      tags.push(ContractTag.OVERFULL);
      if (contract.status === ContractStatus.ACTIVE) tags.push(ContractTag.PENDING_COMPLETE);
    }
    if (contract.endDate) {
      const end = new Date(contract.endDate);
      const thresholdMs = 90 * 24 * 3600 * 1000; // 默认提前 3 个月（M6 收口系统设置）
      if (end.getTime() - now.getTime() <= thresholdMs && end.getTime() >= now.getTime() - 24 * 3600 * 1000) tags.push(ContractTag.EXPIRING);
      if (end < new Date(today)) tags.push(ContractTag.EXPIRED);
    }
    contract.tags = tags;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
  }
}
