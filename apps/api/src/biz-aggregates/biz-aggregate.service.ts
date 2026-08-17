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
    return this.recalcRangeInternal(scope);
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
  private async collectAggRows(scope: RecalcScope): Promise<AggRow[]> {
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

  async listFailures(): Promise<BizAggregateFailureEntity[]> {
    return this.failureRepo.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  // ================= 一致性核对（只告警不自动改写） =================

  async checkConsistency(auth: BizAuthContext): Promise<Array<Record<string, unknown>>> {
    const warnings: Array<Record<string, unknown>> = [];
    // 逐月核对：汇总行 vs 明细聚合
    const months = await this.aggRepo.createQueryBuilder('a').select('DISTINCT a.businessMonth', 'month').getRawMany();
    const targetMonths = months.map((m) => m.month).sort();
    for (const month of targetMonths) {
      const scope = { month };
      const detailRows = await this.collectAggRows(scope);
      const aggRows = await this.aggRepo.findBy({ businessMonth: month });
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

  /** 分析域数据范围过滤：all 不限；city→地市；province→省下辖市；contract 无地域维度→拒绝 */
  private applyAggScope(qb: { andWhere: (cond: string, params?: Record<string, unknown>) => unknown }, auth: BizAuthContext): void {
    const scope = auth.dataScope;
    if (scope.scopeType === 'all') return;
    if (scope.scopeType === 'contract') throw new ForbiddenException('当前账号无经营分析数据范围');
    if (scope.scopeType === 'city') {
      qb.andWhere('a.cityId = :scopeCityId', { scopeCityId: scope.cityId });
      return;
    }
    if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
      qb.andWhere('a.cityId IN (SELECT id FROM biz_cities WHERE province_id IN (:...scopeProvinceIds))', { scopeProvinceIds: scope.provinceIds });
    }
  }

  async overview(auth: BizAuthContext, month?: string) {
    const qb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(qb, auth);
    if (month) qb.andWhere('a.businessMonth = :month', { month });
    const rows = await qb.getMany();
    const total = (field: string) => rows.reduce((s, r) => s + Number(r[field as keyof BizMonthlyAggregateEntity] ?? 0), 0);
    return {
      orderCompletionFen: total('orderCompletionFen'),
      offlineCompletionFen: total('offlineCompletionFen'),
      grossProfitFen: total('grossProfitFen'),
      costFen: total('costFen'),
      netProfitFen: total('netProfitFen'),
      monthCount: new Set(rows.map((r) => r.businessMonth)).size,
    };
  }

  async trend(auth: BizAuthContext, limit = 12) {
    const trendQb = this.aggRepo.createQueryBuilder('a');
    this.applyAggScope(trendQb, auth);
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
    return qb.getRawMany();
  }

  async overrunList(auth: BizAuthContext): Promise<Array<Record<string, unknown>>> {
    // 合同超额：合同累计完工 > 合同额；地市超额：地市累计完工 > 分配额度
    this.applyAggScope({ andWhere: () => undefined }, auth); // contract scope 统一拒绝（与 overview/trend 一致）
    const contracts = await this.contractRepo.find();
    const result: Array<Record<string, unknown>> = [];
    const aggQb = (contractId?: string, cityId?: string) => {
      const qb = this.aggRepo.createQueryBuilder('a');
      this.applyAggScope(qb, auth);
      if (contractId) qb.andWhere('a.contractId = :contractId', { contractId });
      if (cityId) qb.andWhere('a.cityId = :cityId', { cityId });
      return qb;
    };
    for (const contract of contracts) {
      const aggs = await aggQb(contract.id).getMany();
      const totalCompletion = aggs.reduce((s, a) => s + Number(a.orderCompletionFen) + Number(a.offlineCompletionFen), 0);
      const amount = Number(contract.taxInclusiveAmountFen) || 0;
      if (totalCompletion > amount) {
        result.push({ type: 'contract', id: contract.id, contractNo: contract.contractNo, completionFen: totalCompletion, quotaFen: amount, overrunFen: totalCompletion - amount });
      }
    }
    const allocs = await this.allocRepo.findBy({ status: 'active' });
    for (const alloc of allocs) {
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
