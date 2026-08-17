import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { PlatformRole } from '@biz-reporting/shared-types';
import { BizMonthlyAggregateEntity } from '../aggregates/biz-monthly-aggregate.entity';
import { BizAggregateFailureEntity } from '../aggregates/biz-aggregate-failure.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { CityEntity } from '../main-data/city.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';

export interface RecalcScope {
  provinceId?: string;
  cityId?: string;
  contractId?: string;
  month?: string;
}

interface AggRow {
  provinceId: string;
  cityId: string | null;
  contractId: string | null;
  businessMonth: string;
  orderCompletionFen: number;
  offlineCompletionFen: number;
  grossProfitFen: number;
  costFen: number;
}

/**
 * 汇总服务（新基线 M6）
 * 基线：01 §8 / 04 §7 ——
 *  - 汇总口径：订单（非作废）+ 线下完工（已通过非作废）- 作废自动退出；成本（已通过）；
 *  - 维度：省/地市/合同/月度；累计由查询动态求和（month ≤ X）；
 *  - 增量重算：明细变更触发范围重算；失败记录 biz_aggregate_failures，不删除明细；
 *  - 手工重算：失败范围优先；全库需 confirmAll=true 二次确认；
 *  - 校验：利润 = 毛利 - 成本；两级超额标识动态计算；
 *  - 一致性核对：明细 vs 汇总差异列表，只告警不自动改写。
 */
@Injectable()
export class BizAggregateService {
  constructor(
    @InjectRepository(BizMonthlyAggregateEntity)
    private readonly aggRepo: Repository<BizMonthlyAggregateEntity>,
    @InjectRepository(BizAggregateFailureEntity)
    private readonly failureRepo: Repository<BizAggregateFailureEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOfflineCompletionEntity)
    private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(BizSystemSettingEntity)
    private readonly settingRepo: Repository<BizSystemSettingEntity>,
    private readonly dataSource: DataSource,
    private readonly rbac: RbacService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'aggregate', targetId, resultStatus,
    });
  }

  // ================= 重算 =================

  /** 范围重算：失败范围优先；全库需 confirmAll=true */
  async recalc(auth: BizAuthContext, scope: RecalcScope, confirmAll = false): Promise<{ affected: number; failures: number }> {
    // 失败范围优先：无显式范围时先重算失败记录范围
    if (!scope.provinceId && !scope.cityId && !scope.contractId && !scope.month) {
      const failures = await this.failureRepo.findBy({ status: 'open' });
      if (failures.length > 0 && !confirmAll) {
        // 只重算失败范围
        const failedScopes = failures.map((f) => {
          try { return JSON.parse(f.scopeDesc ?? '{}') as RecalcScope; } catch { return {}; }
        });
        let total = 0;
        let failCount = 0;
        for (const fs of failedScopes) {
          const r = await this.recalcRange(auth, fs);
          total += r.affected;
          failCount += r.failures;
        }
        await this.recordOp(auth.userId, 'aggregate.recalc.failed_scope', 'failed-scope');
        return { affected: total, failures: failCount };
      }
      if (failures.length > 0 && confirmAll) {
        throw new BadRequestException('存在未解决失败，请先确认失败范围重算或联系管理员');
      }
    }
    if (!scope.provinceId && !scope.cityId && !scope.contractId && !scope.month && !confirmAll) {
      throw new BadRequestException('全库重算需二次确认（confirmAll=true）');
    }
    const r = await this.recalcRange(auth, scope);
    await this.recordOp(auth.userId, 'aggregate.recalc', scope.contractId ?? scope.cityId ?? scope.provinceId ?? 'all');
    return r;
  }

  private async recalcRange(auth: BizAuthContext, scope: RecalcScope): Promise<{ affected: number; failures: number }> {
    if (scope.cityId) await this.rbac.assertCityScope(auth, scope.cityId);
    if (scope.provinceId) await this.rbac.assertProvinceScope(auth, scope.provinceId);
    if (scope.contractId) await this.assertContractInScope(auth, scope.contractId);
    return this.recalcRangeInternal(scope);
  }

  /** 合同范围校验（与合同详情可见性一致）：all/contract 放行；province 需合同省份在范围内；city 需有本地市分配 */
  private async assertContractInScope(auth: BizAuthContext, contractId: string): Promise<void> {
    const contract = await this.contractRepo.findOneBy({ id: contractId });
    if (!contract) throw new NotFoundException('合同不存在');
    const scope = auth.dataScope;
    if (scope.scopeType === 'all' || scope.scopeType === 'contract') return;
    if (scope.scopeType === 'city') {
      const alloc = await this.allocRepo.findOneBy({ contractId, cityId: scope.cityId ?? '', status: 'active' });
      if (!alloc) throw new ForbiddenException('数据范围不足');
      return;
    }
    if (scope.scopeType === 'province' && scope.provinceIds.length > 0 && !scope.provinceIds.includes(contract.provinceId)) {
      throw new ForbiddenException('数据范围不足');
    }
  }

  /** 内部增量重算（由业务服务在明细变更后调用；调用方已完成权限校验） */
  async recalcInternal(scope: RecalcScope): Promise<{ affected: number; failures: number }> {
    return this.recalcRangeInternal(scope);
  }

  private async recalcRangeInternal(scope: RecalcScope): Promise<{ affected: number; failures: number }> {
    const result = { affected: 0, failures: 0 };
    try {
      await this.dataSource.transaction(async (manager) => {
        // 1. 删除范围内旧汇总
        const qb = manager.createQueryBuilder().delete().from(BizMonthlyAggregateEntity);
        const params: Record<string, string> = {};
        if (scope.provinceId) { qb.andWhere('province_id = :provinceId'); params.provinceId = scope.provinceId; }
        if (scope.cityId) { qb.andWhere('city_id = :cityId'); params.cityId = scope.cityId; }
        if (scope.contractId) { qb.andWhere('contract_id = :contractId'); params.contractId = scope.contractId; }
        if (scope.month) { qb.andWhere('business_month = :month'); params.month = scope.month; }
        qb.setParameters(params);
        await qb.execute();

        // 2. 从明细聚合（订单+完工 → 合同维度；成本 → 地市维度）
        const rows = await this.collectAggRows(scope);
        if (rows.length > 0) {
          const chunk = 300;
          for (let i = 0; i < rows.length; i += chunk) {
            const slice = rows.slice(i, i + chunk);
            await manager.createQueryBuilder().insert().into(BizMonthlyAggregateEntity).values(
              slice.map((r) => ({
                id: randomUUID(), provinceId: r.provinceId, cityId: r.cityId, contractId: r.contractId,
                businessMonth: r.businessMonth,
                orderCompletionFen: r.orderCompletionFen, offlineCompletionFen: r.offlineCompletionFen,
                grossProfitFen: r.grossProfitFen, costFen: r.costFen,
                netProfitFen: r.grossProfitFen - r.costFen,
                staleFlag: false,
              })),
            ).execute();
          }
        }

        // 3. 清理已解决失败（open -> recalculated）
        await manager.createQueryBuilder().update(BizAggregateFailureEntity)
          .set({ status: 'recalculated', recalculatedAt: new Date() })
          .where('status = :open', { open: 'open' })
          .execute();
      });
      result.affected = await this.aggRepo.count();
    } catch (error) {
      result.failures = 1;
      await this.failureRepo.save({
        id: randomUUID(),
        businessObjectType: 'recalc',
        businessObjectId: scope.contractId ?? scope.cityId ?? scope.provinceId ?? 'all',
        scopeDesc: JSON.stringify(scope),
        error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
        status: 'open',
        firstAt: new Date(),
      });
    }
    return result;
  }

  /** 从明细聚合到汇总行（成本按地市维度，不关联合同） */
  private async collectAggRows(scope: RecalcScope, auth?: BizAuthContext): Promise<AggRow[]> {
    const orderQb = this.orderRowRepo.createQueryBuilder('o')
      .select('o.provinceId', 'provinceId')
      .addSelect('o.cityId', 'cityId')
      .addSelect('o.contractId', 'contractId')
      .addSelect('o.businessMonth', 'businessMonth')
      .addSelect('SUM(o.completionAmountFen)', 'orderCompletionFen')
      .addSelect('SUM(o.grossProfitFen)', 'grossProfitFen')
      .where('o.isVoid = 0');
    const offlineQb = this.offlineRepo.createQueryBuilder('f')
      .select('f.cityId', 'cityId')
      .addSelect('f.contractId', 'contractId')
      .addSelect('f.businessMonth', 'businessMonth')
      .addSelect('SUM(f.amountFen)', 'offlineCompletionFen')
      .addSelect('SUM(f.grossProfitFen)', 'grossProfitFen')
      .where('f.status = :status', { status: 'approved' });
    this.applyScope(orderQb, scope, 'o');
    // 完工表无 province_id 列：省级范围用 地市→省份 子查询过滤（修复省级重算查询）
    if (scope.provinceId) offlineQb.andWhere('f.cityId IN (SELECT id FROM biz_cities WHERE province_id = :offlineProvinceId)', { offlineProvinceId: scope.provinceId });
    else this.applyScope(offlineQb, scope, 'f');
    // auth 数据范围过滤（checkConsistency 明细侧与汇总侧使用完全相同范围，防止跨范围 missing_aggregate 泄露）
    if (auth) {
      this.applyAggScope(orderQb, auth, 'o');
      this.applyAggScope(offlineQb, auth, 'f');
    }

    // 预加载地市→省份映射（完工/成本表无 province_id 列）
    const { CityEntity } = await import('../main-data/city.entity');
    const cityRepo = this.dataSource.getRepository(CityEntity);
    const cityRows = await cityRepo.find();
    const provinceByCity = new Map(cityRows.map((c) => [c.id, c.provinceId]));

    const orderRows = (await orderQb.groupBy('o.provinceId, o.cityId, o.contractId, o.businessMonth').getRawMany()) as unknown as AggRow[];
    const offlineRows = (await offlineQb.groupBy('f.cityId, f.contractId, f.businessMonth').getRawMany()) as unknown as AggRow[];
    for (const r of offlineRows) r.provinceId = (r.cityId && provinceByCity.get(r.cityId)) ?? '';

    // 合并订单+完工（同一维度累加）
    const map = new Map<string, AggRow>();
    for (const r of orderRows) {
      const key = `${r.provinceId}|${r.cityId ?? ''}|${r.contractId ?? ''}|${r.businessMonth}`;
      map.set(key, { provinceId: r.provinceId, cityId: r.cityId, contractId: r.contractId, businessMonth: r.businessMonth, orderCompletionFen: Number(r.orderCompletionFen) || 0, offlineCompletionFen: 0, grossProfitFen: Number(r.grossProfitFen) || 0, costFen: 0 });
    }
    for (const r of offlineRows) {
      const key = `${r.provinceId}|${r.cityId ?? ''}|${r.contractId ?? ''}|${r.businessMonth}`;
      const existing = map.get(key);
      const offlineGross = Number(r.grossProfitFen) || 0;
      if (existing) {
        existing.offlineCompletionFen += Number(r.offlineCompletionFen) || 0;
        existing.grossProfitFen += offlineGross;
      } else {
        map.set(key, { provinceId: r.provinceId, cityId: r.cityId, contractId: r.contractId, businessMonth: r.businessMonth, orderCompletionFen: 0, offlineCompletionFen: Number(r.offlineCompletionFen) || 0, grossProfitFen: offlineGross, costFen: 0 });
      }
    }

    // 成本按地市（contractId=NULL 维度；不关联合同）
    if (scope.contractId) return [...map.values()];
    const costQb = this.costRepo.createQueryBuilder('c')
      .select('c.cityId', 'cityId')
      .addSelect('c.businessMonth', 'businessMonth')
      .addSelect('SUM(c.amountFen)', 'costFen')
      .where('c.status = :status', { status: 'approved' });
    if (scope.cityId) costQb.andWhere('c.cityId = :cityId', { cityId: scope.cityId });
    if (scope.provinceId) costQb.andWhere('c.cityId IN (SELECT id FROM biz_cities WHERE province_id = :costProvinceId)', { costProvinceId: scope.provinceId });
    if (scope.month) costQb.andWhere('c.businessMonth = :month', { month: scope.month });
    if (auth) this.applyAggScope(costQb, auth, 'c');
    const costRows = (await costQb.groupBy('c.cityId, c.businessMonth').getRawMany()) as Array<{ cityId: string; businessMonth: string; costFen: string }>;
    for (const r of costRows) {
      // 成本行独立（contractId=NULL，不关联合同；一个地市多个合同时成本不可拆分）
      map.set(`cost|${r.cityId}|${r.businessMonth}`, {
        provinceId: provinceByCity.get(r.cityId) ?? '00000000-0000-4000-8000-000000000000',
        cityId: r.cityId, contractId: null, businessMonth: r.businessMonth,
        orderCompletionFen: 0, offlineCompletionFen: 0, grossProfitFen: 0, costFen: Number(r.costFen) || 0,
      });
    }
    return [...map.values()];
  }

  private applyScope(qb: { andWhere: (cond: string, params?: Record<string, string>) => unknown }, scope: RecalcScope, alias: string): void {
    if (scope.provinceId) qb.andWhere(`${alias}.provinceId = :provinceId`, { provinceId: scope.provinceId });
    if (scope.cityId) qb.andWhere(`${alias}.cityId = :cityId`, { cityId: scope.cityId });
    if (scope.contractId) qb.andWhere(`${alias}.contractId = :contractId`, { contractId: scope.contractId });
    if (scope.month) qb.andWhere(`${alias}.businessMonth = :month`, { month: scope.month });
  }

  async listFailures(auth: BizAuthContext): Promise<BizAggregateFailureEntity[]> {
    const all = await this.failureRepo.find({ order: { createdAt: 'DESC' }, take: 200 });
    const scope = auth.dataScope;
    // 预加载：合同→省份、合同→分配地市（失败记录可见性按合同实际省份与分配地市判断，禁止放行任意 contractId）
    const contracts = await this.contractRepo.find({ select: { id: true, provinceId: true } });
    const provinceByContract = new Map(contracts.map((c) => [c.id, c.provinceId]));
    const allocs = await this.allocRepo.find({ where: { status: 'active' }, select: { contractId: true, cityId: true } });
    const citiesByContract = new Map<string, Set<string>>();
    for (const a of allocs) {
      if (!citiesByContract.has(a.contractId)) citiesByContract.set(a.contractId, new Set());
      citiesByContract.get(a.contractId)!.add(a.cityId);
    }
    const visible = all.filter((f) => {
      if (scope.scopeType === 'all' || scope.scopeType === 'contract') return true;
      let s: RecalcScope;
      try { s = JSON.parse(f.scopeDesc ?? '{}') as RecalcScope; } catch { return false; }
      if (scope.scopeType === 'city') {
        // 直接地市维度：必须等于绑定地市；合同维度：合同必须已分配绑定地市
        if (s.cityId != null) return s.cityId === scope.cityId;
        if (s.contractId != null) return citiesByContract.get(s.contractId)?.has(scope.cityId ?? '') ?? false;
        return false;
      }
      if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
        // 直接省份维度：必须在范围内；合同维度：合同实际省份必须在范围内（禁止仅 contractId 即放行）
        if (s.provinceId != null) return scope.provinceIds.includes(s.provinceId);
        if (s.contractId != null) return provinceByContract.has(s.contractId) && scope.provinceIds.includes(provinceByContract.get(s.contractId)!);
        return false;
      }
      return false;
    });
    return visible.slice(0, 50);
  }

  // ================= 一致性核对（只告警不自动改写） =================

  async checkConsistency(auth: BizAuthContext): Promise<Array<Record<string, unknown>>> {
    const warnings: Array<Record<string, unknown>> = [];
    // 逐月核对：汇总行 vs 明细聚合（按 auth 数据范围过滤可见维度）
    const monthsQb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(monthsQb, auth);
    const months = await monthsQb.select('DISTINCT a.businessMonth', 'month').getRawMany();
    const targetMonths = months.map((m) => m.month).sort();
    for (const month of targetMonths) {
      const scope = { month };
      const detailRows = await this.collectAggRows(scope, auth);
      const aggQb = this.aggRepo.createQueryBuilder('a');
      this.applyAggScope(aggQb, auth);
      const aggRows = await aggQb.andWhere('a.businessMonth = :month', { month }).getMany();
      // 校验：利润 = 毛利 - 成本（科目平衡）
      for (const agg of aggRows) {
        const expectedNet = Number(agg.grossProfitFen) - Number(agg.costFen);
        if (Number(agg.netProfitFen) !== expectedNet) {
          warnings.push({ type: 'net_profit_mismatch', month, dimension: agg.contractId ?? agg.cityId, detail: `net=${agg.netProfitFen} expected=${expectedNet}` });
        }
      }
      // 维度缺失检查（明细有但汇总无）
      const detailKeys = new Set(detailRows.map((r) => `${r.provinceId}|${r.cityId ?? ''}|${r.contractId ?? ''}`));
      const aggKeys = new Set(aggRows.map((r) => `${r.provinceId}|${r.cityId ?? ''}|${r.contractId ?? ''}`));
      for (const key of detailKeys) {
        if (!aggKeys.has(key)) warnings.push({ type: 'missing_aggregate', month, dimension: key, detail: '明细存在但汇总缺失' });
      }
    }
    return warnings;
  }

  // ================= 分析聚合 API =================

  /** 分析域数据范围过滤：all 不限；city→地市；province→省下辖市；contract 无地域维度→拒绝（alias 参数化，明细侧复用） */
  private applyAggScope(qb: { andWhere: (cond: string, params?: Record<string, unknown>) => unknown }, auth: BizAuthContext, alias = 'a'): void {
    const scope = auth.dataScope;
    if (scope.scopeType === 'all') return;
    if (scope.scopeType === 'contract') throw new ForbiddenException('当前账号无经营分析数据范围');
    if (scope.scopeType === 'city') {
      qb.andWhere(`${alias}.cityId = :scopeCityId`, { scopeCityId: scope.cityId });
      return;
    }
    if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
      qb.andWhere(`${alias}.cityId IN (SELECT id FROM biz_cities WHERE province_id IN (:...scopeProvinceIds))`, { scopeProvinceIds: scope.provinceIds });
    }
  }

  /** 合同可见性（与合同详情/重算一致）：all/contract 全量；city 需 active 分配到绑定地市；province 需合同省份在范围内；cityId 附加过滤 */
  private isContractVisible(auth: BizAuthContext, contract: { id: string; provinceId: string }, cityId?: string, citiesByContract?: Map<string, Set<string>>): boolean {
    const scope = auth.dataScope;
    if (scope.scopeType === 'all' || scope.scopeType === 'contract') {
      if (cityId) return citiesByContract?.get(contract.id)?.has(cityId) ?? false;
      return true;
    }
    if (scope.scopeType === 'city') {
      if (!(citiesByContract?.get(contract.id)?.has(scope.cityId ?? '') ?? false)) return false;
      if (cityId) return cityId === scope.cityId;
      return true;
    }
    if (scope.scopeType === 'province') {
      // provinceIds 为空 = 全部省份（admin 默认）；非空则合同省份必须在范围内
      if (scope.provinceIds.length > 0 && !scope.provinceIds.includes(contract.provinceId)) return false;
      if (cityId) return citiesByContract?.get(contract.id)?.has(cityId) ?? false;
      return true;
    }
    return false;
  }

  /** 合同库存指标（从合同+分配表出发，含零进度合同）：合同数=可见合同数；合同额=未带地市筛选时全额、带地市筛选时按该地市配额比例分摊（与 byCity 同一口径） */
  private async contractInventory(auth: BizAuthContext, cityId?: string): Promise<{ ids: Set<string>; amountFen: number }> {
    const contracts = await this.contractRepo.find({ select: { id: true, provinceId: true, taxInclusiveAmountFen: true } });
    const allocs = await this.allocRepo.find({ where: { status: 'active' } });
    const citiesByContract = new Map<string, Set<string>>();
    for (const a of allocs) {
      if (!citiesByContract.has(a.contractId)) citiesByContract.set(a.contractId, new Set());
      citiesByContract.get(a.contractId)!.add(a.cityId);
    }
    const visible = contracts.filter((c) => this.isContractVisible(auth, c, cityId, citiesByContract));
    let amountFen: number;
    if (cityId) {
      // 地市口径：合同额 × (该地市分配配额/合同总配额)，与 byCity 行内 contractAmountFen 完全一致
      const totalQuotaByContract = new Map<string, number>();
      for (const a of allocs) totalQuotaByContract.set(a.contractId, (totalQuotaByContract.get(a.contractId) ?? 0) + Number(a.quotaFen || 0));
      amountFen = 0;
      for (const c of visible) {
        const cityAllocs = allocs.filter((a) => a.contractId === c.id && a.cityId === cityId);
        if (cityAllocs.length === 0) continue;
        const quota = cityAllocs.reduce((sum, a) => sum + (Number(a.quotaFen) || 0), 0);
        const totalQuota = totalQuotaByContract.get(c.id) || 0;
        const allocCount = allocs.filter((x) => x.contractId === c.id).length || 1;
        const share = totalQuota > 0 ? quota / totalQuota : 1 / allocCount;
        amountFen += (Number(c.taxInclusiveAmountFen) || 0) * share;
      }
      amountFen = Math.round(amountFen);
    } else {
      amountFen = visible.reduce((sum, c) => sum + (Number(c.taxInclusiveAmountFen) || 0), 0);
    }
    return { ids: new Set(visible.map((c) => c.id)), amountFen };
  }

  async overview(auth: BizAuthContext, month?: string, cityId?: string) {
    const qb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(qb, auth);
    if (cityId) qb.andWhere('a.cityId = :overviewCityId', { overviewCityId: cityId });
    if (month) qb.andWhere('a.businessMonth = :month', { month });
    const rows = await qb.getMany();
    const total = (field: string) => rows.reduce((s, r) => s + Number(r[field as keyof BizMonthlyAggregateEntity] ?? 0), 0);
    // 合同库存指标从合同+分配表出发（含零进度合同：已建立分配但无订单/完工），经营金额仍来自汇总表
    const inventory = await this.contractInventory(auth, cityId);
    return {
      orderCompletionFen: total('orderCompletionFen'),
      offlineCompletionFen: total('offlineCompletionFen'),
      grossProfitFen: total('grossProfitFen'),
      costFen: total('costFen'),
      netProfitFen: total('netProfitFen'),
      contractCount: inventory.ids.size,
      totalContractAmountFen: inventory.amountFen,
      totalCompletionFen: total('orderCompletionFen') + total('offlineCompletionFen'),
      monthCount: new Set(rows.map((r) => r.businessMonth)).size,
    };
  }

  async trend(auth: BizAuthContext, limit = 12, cityId?: string) {
    const trendQb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(trendQb, auth);
    if (cityId) trendQb.andWhere('a.cityId = :trendCityId', { trendCityId: cityId });
    const rows = await trendQb
      .select('a.businessMonth', 'month')
      .addSelect('SUM(a.orderCompletionFen)', 'orderCompletionFen')
      .addSelect('SUM(a.offlineCompletionFen)', 'offlineCompletionFen')
      .addSelect('SUM(a.grossProfitFen)', 'grossProfitFen')
      .addSelect('SUM(a.costFen)', 'costFen')
      .addSelect('SUM(a.netProfitFen)', 'netProfitFen')
      .groupBy('a.businessMonth')
      .orderBy('a.businessMonth', 'DESC')
      .limit(limit)
      .getRawMany();
    return rows.reverse();
  }

  async byCity(auth: BizAuthContext, month?: string) {
    // 1) 合同+分配表出发：地市库存（含只有分配、无经营数据的地市）
    const contracts = await this.contractRepo.find({ select: { id: true, provinceId: true, taxInclusiveAmountFen: true } });
    const allocs = await this.allocRepo.find({ where: { status: 'active' } });
    const citiesByContract = new Map<string, Set<string>>();
    for (const a of allocs) {
      if (!citiesByContract.has(a.contractId)) citiesByContract.set(a.contractId, new Set());
      citiesByContract.get(a.contractId)!.add(a.cityId);
    }
    const totalQuotaByContract = new Map<string, number>();
    for (const a of allocs) totalQuotaByContract.set(a.contractId, (totalQuotaByContract.get(a.contractId) ?? 0) + Number(a.quotaFen || 0));
    const amountByContract = new Map(contracts.map((c) => [c.id, Number(c.taxInclusiveAmountFen) || 0]));
    const cityInventory = new Map<string, { contractCount: number; contractAmountFen: number; contractIds: Set<string> }>();
    for (const a of allocs) {
      const contract = contracts.find((c) => c.id === a.contractId);
      // P0：分配地市也必须在可见范围内——共享合同的其他地市分配不得泄露（济南管理员只看到济南行）
      if (!contract || !this.isContractVisible(auth, contract, a.cityId, citiesByContract)) continue;
      const entry = cityInventory.get(a.cityId) ?? { contractCount: 0, contractAmountFen: 0, contractIds: new Set() };
      if (!entry.contractIds.has(a.contractId)) {
        entry.contractIds.add(a.contractId);
        entry.contractCount += 1;
        const quota = Number(a.quotaFen) || 0;
        const totalQuota = totalQuotaByContract.get(a.contractId) || 0;
        const allocCount = allocs.filter((x) => x.contractId === a.contractId).length || 1;
        const share = totalQuota > 0 ? quota / totalQuota : 1 / allocCount;
        entry.contractAmountFen += (amountByContract.get(a.contractId) ?? 0) * share;
      }
      cityInventory.set(a.cityId, entry);
    }
    // 2) 经营金额：汇总表按范围+month 聚合（左连接语义：无 agg 行地市补 0）
    const qb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(qb, auth);
    qb
      .select('a.cityId', 'cityId')
      .addSelect('SUM(a.orderCompletionFen)', 'orderCompletionFen')
      .addSelect('SUM(a.offlineCompletionFen)', 'offlineCompletionFen')
      .addSelect('SUM(a.grossProfitFen)', 'grossProfitFen')
      .addSelect('SUM(a.costFen)', 'costFen')
      .addSelect('SUM(a.netProfitFen)', 'netProfitFen')
      .groupBy('a.cityId');
    if (month) qb.andWhere('a.businessMonth = :month', { month });
    const aggRows = await qb.getRawMany();
    const aggByCity = new Map(aggRows.map((r) => [String(r.cityId), r]));
    // 3) 合并输出
    const { CityEntity } = await import('../main-data/city.entity');
    const cityEntities = await this.dataSource.getRepository(CityEntity).find({ select: { id: true, name: true } });
    const nameById = new Map(cityEntities.map((c) => [String(c.id), String(c.name)]));
    const out: Array<Record<string, unknown>> = [];
    for (const [cityId, inv] of cityInventory) {
      const agg = aggByCity.get(cityId) ?? {};
      out.push({
        cityId,
        cityName: nameById.get(cityId) ?? cityId,
        contractCount: inv.contractCount,
        contractAmountFen: Math.round(inv.contractAmountFen),
        orderCompletionFen: Number(agg.orderCompletionFen) || 0,
        offlineCompletionFen: Number(agg.offlineCompletionFen) || 0,
        grossProfitFen: Number(agg.grossProfitFen) || 0,
        costFen: Number(agg.costFen) || 0,
        netProfitFen: Number(agg.netProfitFen) || 0,
      });
    }
    // agg 行存在但无分配记录的地市（理论不出现，兜底）
    for (const [cityId, agg] of aggByCity) {
      if (!cityInventory.has(cityId)) {
        out.push({
          cityId,
          cityName: nameById.get(cityId) ?? cityId,
          contractCount: 0,
          contractAmountFen: 0,
          orderCompletionFen: Number(agg.orderCompletionFen) || 0,
          offlineCompletionFen: Number(agg.offlineCompletionFen) || 0,
          grossProfitFen: Number(agg.grossProfitFen) || 0,
          costFen: Number(agg.costFen) || 0,
          netProfitFen: Number(agg.netProfitFen) || 0,
        });
      }
    }
    return out;
  }

  /** 合同到期/满额提醒（实时计算，不依赖手工 refresh-alerts 与汇总重算）：到期按 endDate+系统阈值，满额按订单/已审核线下完工明细实时聚合；按 auth 数据范围过滤 */
  async analysisAlerts(auth: BizAuthContext, cityId?: string): Promise<Array<Record<string, unknown>>> {
    const contracts = await this.contractRepo.find({ order: { endDate: 'ASC' } });
    const scope = auth.dataScope;
    // 预加载：合同→分配地市（city 范围可见性 + cityId 附加筛选）
    const allocs = await this.allocRepo.find({ where: { status: 'active' } });
    const citiesByContract = new Map<string, Set<string>>();
    for (const a of allocs) {
      if (!citiesByContract.has(a.contractId)) citiesByContract.set(a.contractId, new Set());
      citiesByContract.get(a.contractId)!.add(a.cityId);
    }
    const visible = contracts.filter((c) => this.isContractVisible(auth, c, cityId, citiesByContract));
    // 完工明细实时聚合（不依赖汇总表/重算）：未作废订单 + 已审核线下完工
    const orderRows = await this.orderRowRepo.createQueryBuilder('o')
      .select('o.contractId', 'contractId')
      .addSelect('SUM(o.completionAmountFen)', 'amount')
      .where('o.isVoid = 0')
      .groupBy('o.contractId')
      .getRawMany();
    const offlineRows = await this.offlineRepo.createQueryBuilder('f')
      .select('f.contractId', 'contractId')
      .addSelect('SUM(f.amountFen)', 'amount')
      .where('f.status = :status', { status: 'approved' })
      .groupBy('f.contractId')
      .getRawMany();
    const completionByContract = new Map<string, number>();
    for (const r of orderRows) completionByContract.set(String(r.contractId), (completionByContract.get(String(r.contractId)) ?? 0) + Number(r.amount || 0));
    for (const r of offlineRows) completionByContract.set(String(r.contractId), (completionByContract.get(String(r.contractId)) ?? 0) + Number(r.amount || 0));
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const setting = await this.settingRepo.findOneBy({ settingKey: 'contract_expiry_warning_days' });
    const warningDays = Number(setting?.settingValue ?? 90);
    const thresholdMs = warningDays * 24 * 3600 * 1000;
    const alerts: Array<Record<string, unknown>> = [];
    for (const c of visible) {
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      const completion = completionByContract.get(c.id) ?? 0;
      const progress = amount > 0 ? (completion / amount) * 100 : 0;
      if (progress >= 90 && progress < 100) alerts.push({ contractId: c.id, contractNo: c.contractNo, contractName: c.contractName, alertType: 'nearly_full', endDate: c.endDate, status: c.status });
      if (progress >= 100) alerts.push({ contractId: c.id, contractNo: c.contractNo, contractName: c.contractName, alertType: 'overfull', endDate: c.endDate, status: c.status });
      if (c.endDate) {
        const end = new Date(c.endDate);
        if (end.getTime() - now.getTime() <= thresholdMs && end.getTime() >= new Date(today).getTime()) {
          alerts.push({ contractId: c.id, contractNo: c.contractNo, contractName: c.contractName, alertType: 'expiring', endDate: c.endDate, status: c.status });
        }
        if (end.getTime() < new Date(today).getTime()) {
          alerts.push({ contractId: c.id, contractNo: c.contractNo, contractName: c.contractName, alertType: 'expired', endDate: c.endDate, status: c.status });
        }
      }
    }
    return alerts.slice(0, 100);
  }

  async overrunList(auth: BizAuthContext, month?: string, cityId?: string): Promise<Array<Record<string, unknown>>> {
    // 合同超额：合同累计完工 > 合同额；地市超额：地市累计完工 > 分配额度（支持整页组合筛选 month/cityId）
    this.applyAggScope({ andWhere: () => undefined }, auth); // contract scope 统一拒绝（与 overview/trend 一致）
    const contracts = await this.contractRepo.find();
    const allocs = await this.allocRepo.findBy({ status: 'active' });
    const citiesByContract = new Map<string, Set<string>>();
    for (const a of allocs) {
      if (!citiesByContract.has(a.contractId)) citiesByContract.set(a.contractId, new Set());
      citiesByContract.get(a.contractId)!.add(a.cityId);
    }
    const result: Array<Record<string, unknown>> = [];
    const aggQb = (contractId?: string, aggCityId?: string) => {
      const qb = this.aggRepo.createQueryBuilder('a');
      this.applyAggScope(qb, auth);
      if (contractId) qb.andWhere('a.contractId = :contractId', { contractId });
      if (aggCityId) qb.andWhere('a.cityId = :aggCityId', { aggCityId });
      if (month) qb.andWhere('a.businessMonth = :month', { month });
      return qb;
    };
    for (const contract of contracts) {
      // 合同超额只统计可见合同（与详情/重算一致），cityId 附加过滤该地市分配
      if (!this.isContractVisible(auth, contract, cityId, citiesByContract)) continue;
      const aggs = await aggQb(contract.id).getMany();
      const totalCompletion = aggs.reduce((s, a) => s + Number(a.orderCompletionFen) + Number(a.offlineCompletionFen), 0);
      const amount = Number(contract.taxInclusiveAmountFen) || 0;
      if (totalCompletion > amount) {
        result.push({ type: 'contract', id: contract.id, contractNo: contract.contractNo, completionFen: totalCompletion, quotaFen: amount, overrunFen: totalCompletion - amount });
      }
    }
    for (const alloc of allocs) {
      const contract = contracts.find((c) => c.id === alloc.contractId);
      if (!contract || !this.isContractVisible(auth, contract, undefined, citiesByContract)) continue;
      if (cityId && alloc.cityId !== cityId) continue;
      // 地市超额必须按 contractId+cityId 汇总（与分配额度同粒度；一个地市多个合同互不混淆）
      const aggs = await aggQb(alloc.contractId, alloc.cityId).getMany();
      const total = aggs.reduce((s, a) => s + Number(a.orderCompletionFen) + Number(a.offlineCompletionFen), 0);
      const quota = Number(alloc.quotaFen) || 0;
      if (total > quota) {
        result.push({ type: 'city', contractId: alloc.contractId, cityId: alloc.cityId, completionFen: total, quotaFen: quota, overrunFen: total - quota });
      }
    }
    return result;
  }

  /** 合同维度累计（含成本/净利），供合同详情聚合 */
  async contractAggregate(contractId: string) {
    const aggs = await this.aggRepo.findBy({ contractId });
    return {
      orderCompletionFen: aggs.reduce((s, a) => s + Number(a.orderCompletionFen), 0),
      offlineCompletionFen: aggs.reduce((s, a) => s + Number(a.offlineCompletionFen), 0),
      grossProfitFen: aggs.reduce((s, a) => s + Number(a.grossProfitFen), 0),
      costFen: aggs.reduce((s, a) => s + Number(a.costFen), 0),
      netProfitFen: aggs.reduce((s, a) => s + Number(a.netProfitFen), 0),
    };
  }

  // ================= 系统设置（DEV-055） =================

  async listSettings(): Promise<Array<{ key: string; value: string; description: string | null }>> {
    const settings = await this.settingRepo.find({ order: { settingKey: 'ASC' } });
    return settings.map((s) => ({ key: s.settingKey, value: s.settingValue, description: s.description }));
  }

  async updateSetting(auth: BizAuthContext, key: string, value: string): Promise<void> {
    const setting = await this.settingRepo.findOneBy({ settingKey: key });
    if (!setting) throw new NotFoundException('设置项不存在');
    setting.settingValue = String(value).slice(0, 255);
    setting.updatedBy = auth.userId;
    await this.settingRepo.save(setting);
    await this.recordOp(auth.userId, 'settings.update', key);
  }

  async getSettingInt(key: string, fallback: number): Promise<number> {
    const setting = await this.settingRepo.findOneBy({ settingKey: key });
    if (!setting) return fallback;
    const value = Number(setting.settingValue);
    return Number.isFinite(value) ? value : fallback;
  }
}
