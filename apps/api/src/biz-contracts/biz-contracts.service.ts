import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Not, In } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
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
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { readWorkbookSafe, WORKBOOK_LIMITS } from '../common/files/workbook-policy';

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
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizSystemSettingEntity)
    private readonly settingRepo: Repository<BizSystemSettingEntity>,
    private readonly rbac: RbacService,
    private readonly dataSource: DataSource,
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

  /** 合同可见性：all/contract 放行；city 需已分配绑定地市；province 需合同省份在范围内 */
  private async assertContractVisible(auth: BizAuthContext, contract: BizContractEntity): Promise<void> {
    const scope = auth.dataScope;
    if (scope.scopeType === 'all' || scope.scopeType === 'contract') return;
    if (scope.scopeType === 'city') {
      const alloc = await this.allocationRepo.findOneBy({ contractId: contract.id, cityId: scope.cityId ?? '', status: 'active' });
      if (!alloc) throw new ForbiddenException('数据范围不足');
      return;
    }
    if (scope.scopeType === 'province' && scope.provinceIds.length > 0 && !scope.provinceIds.includes(contract.provinceId)) {
      throw new ForbiddenException('数据范围不足');
    }
  }

  // ================= 列表与详情 =================

  /** 合同列表（按数据范围过滤；city_user 仅已分配本地市） */
  async list(auth: BizAuthContext, filter: { provinceId?: string; cityId?: string; status?: string; keyword?: string }): Promise<BizContractEntity[]> {
    await this.rbac.assertProvinceScope(auth, filter.provinceId);
    if (filter.cityId) await this.rbac.assertCityScope(auth, filter.cityId);

    const query = this.contractRepo.createQueryBuilder('c');
    if (filter.status) query.andWhere('c.status = :status', { status: filter.status });
    if (filter.provinceId) query.andWhere('c.provinceId = :provinceId', { provinceId: filter.provinceId });
    const keyword = filter.keyword?.trim();
    if (keyword) {
      query.andWhere('(c.contractNo LIKE :keyword OR c.contractName LIKE :keyword)', { keyword: `%${keyword}%` });
    }

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
    await this.assertContractVisible(auth, contract);

    // 数据范围裁剪：地市用户只看自己地市的分配/费率/完工；省范围看省下辖市；all/contract 全量
    let visibleCityIds: Set<string> | null = null;
    if (auth.dataScope.scopeType === 'city') {
      visibleCityIds = auth.dataScope.cityId ? new Set([auth.dataScope.cityId]) : new Set();
    } else if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      const provinceCities = await this.cityRepo.createQueryBuilder('ct')
        .select('ct.id', 'id')
        .where('ct.provinceId IN (:...provinceIds)', { provinceIds: auth.dataScope.provinceIds })
        .getRawMany();
      visibleCityIds = new Set(provinceCities.map((c) => c.id));
    }
    const inScope = (cityId: string | null | undefined) => !visibleCityIds || (cityId != null && visibleCityIds.has(cityId));

    const allocations = (await this.allocationRepo.findBy({ contractId: id })).filter((a) => inScope(a.cityId));
    const feeRates = (await this.feeRateRepo.findBy({ contractId: id })).filter((f) => inScope(f.cityId));
    const alerts = await this.alertRepo.findBy({ contractId: id, currentStatus: 'active' });

    // 有效完工（订单未作废 + 线下完工已审核未作废；按可见地市过滤）
    const orders = (await this.orderRowRepo.findBy({ contractId: id, isVoid: false, validationStatus: 'valid' })).filter((o) => inScope(o.cityId));
    const offlines = (await this.offlineRepo.findBy({ contractId: id, status: 'approved' })).filter((o) => inScope(o.cityId));
    const orderCompletionFen = orders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0);
    const offlineCompletionFen = offlines.reduce((s, o) => s + Number(o.amountFen), 0);
    const totalCompletionFen = orderCompletionFen + offlineCompletionFen;
    const contractAmountFen = Number(contract.taxInclusiveAmountFen) || 0;
    // 进度口径：all/contract 用合同额（合同整体进度）；city/province 范围用可见地市【active】分配额度合计（本地市进度，明确标注 progressBasis；已取消分配不稀释分母）
    const visibleQuotaFen = allocations.filter((a) => a.status === 'active').reduce((sum, a) => sum + (Number(a.quotaFen) || 0), 0);
    const progressBasis = visibleCityIds ? (auth.dataScope.scopeType === 'city' ? 'city-quota' : 'province-quota') : 'contract';
    const progressDenominator = visibleCityIds ? visibleQuotaFen : contractAmountFen;
    const progress = progressDenominator > 0 ? (totalCompletionFen / progressDenominator) * 100 : 0;
    const overrunFen = Math.max(totalCompletionFen - progressDenominator, 0);

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

    let activationIssues: string[] = [];
    if (contract.status === ContractStatus.DRAFT) {
      try {
        activationIssues = await this.completenessIssues(contract);
      } catch (error) {
        activationIssues = [error instanceof BadRequestException ? String(error.message) : '合同资料完整性校验失败'];
      }
    }

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
      activationIssues,
      alerts: alerts.map((a) => ({ alertType: a.alertType, firstTriggeredAt: a.firstTriggeredAt })),
      progress: {
        orderCompletionFen,
        offlineCompletionFen,
        totalCompletionFen,
        contractAmountFen,
        progress,
        progressBasis,
        quotaFen: visibleCityIds ? visibleQuotaFen : null,
        remainingFen: progressDenominator - totalCompletionFen,
        overrunFen,
      },
      // M6：成本/净利（按合同分配地市汇总已审核成本）
      finance: await this.financeForContract(contract, visibleCityIds),
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

  async importWorkbook(auth: BizAuthContext, filename: string, buffer: Buffer): Promise<{ created: number; contractNos: string[] }> {
    if (!filename.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('仅支持 .xlsx 合同模板文件');
    if (!['super_admin', 'admin', 'contract_manager'].includes(auth.roleCode)) {
      throw new ForbiddenException('当前账号无合同导入权限');
    }

    const workbook = readWorkbookSafe(buffer, { maxRowsPerSheet: WORKBOOK_LIMITS.maxRowsPerSheet });
    if (workbook.SheetNames.length !== 1) throw new BadRequestException('合同导入文件必须包含一个工作表');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const header = (rows[0] ?? []).map((value) => String(value).trim());
    const indexes = this.contractImportIndexes(header);
    const required = ['合同编号', '合同名称', '含税合同额（元）', '所属省份'];
    const missing = required.filter((name) => indexes.get(name) === undefined);
    if (missing.length > 0) throw new BadRequestException(`缺少必填列：${missing.join('、')}`);

    const provinceByName = new Map<string, string>();
    for (const province of await this.provinceRepo.find()) {
      provinceByName.set(province.name.trim(), province.id);
      provinceByName.set(province.code.trim(), province.id);
    }

    const pending: Array<CreateContractDto & { rowNo: number }> = [];
    const seen = new Set<string>();
    const errors: string[] = [];
    rows.slice(1).forEach((source, offset) => {
      const rowNo = offset + 2;
      const values = Array.isArray(source) ? source.map((value) => String(value ?? '').trim()) : [];
      if (values.every((value) => !value)) return;
      const read = (name: string) => {
        const index = indexes.get(name);
        return index === undefined ? '' : values[index] ?? '';
      };
      const contractNo = read('合同编号');
      const contractName = read('合同名称');
      const amountText = read('含税合同额（元）').replace(/,/g, '');
      const amount = Number(amountText);
      const provinceText = read('所属省份');
      const provinceId = provinceByName.get(provinceText);
      if (!contractNo || !contractName || !provinceId || !Number.isFinite(amount) || amount < 0) {
        errors.push(`第 ${rowNo} 行：合同编号、合同名称、所属省份和非负含税合同额为必填项`);
        return;
      }
      if (seen.has(contractNo)) {
        errors.push(`第 ${rowNo} 行：合同编号 ${contractNo} 在文件中重复`);
        return;
      }
      seen.add(contractNo);
      const startDate = this.normalizeContractDate(read('开始日期'));
      const endDate = this.normalizeContractDate(read('结束日期'));
      if ((read('开始日期') && !startDate) || (read('结束日期') && !endDate)) {
        errors.push(`第 ${rowNo} 行：开始日期或结束日期格式无效，应为 YYYY-MM-DD`);
        return;
      }
      pending.push({
        rowNo,
        contractNo,
        contractName,
        taxInclusiveAmountFen: Math.round(amount * 100),
        provinceId,
        startDate,
        endDate,
      });
    });
    if (pending.length === 0 && errors.length === 0) throw new BadRequestException('合同导入文件没有数据行');
    if (errors.length > 0) throw new BadRequestException(errors.slice(0, 20).join('；'));

    const existing = await this.contractRepo.createQueryBuilder('c')
      .select('c.contractNo', 'contractNo')
      .where('c.contractNo IN (:...contractNos)', { contractNos: pending.map((row) => row.contractNo) })
      .getRawMany<{ contractNo: string }>();
    if (existing.length > 0) throw new BadRequestException(`合同编号已存在：${existing.map((row) => row.contractNo).join('、')}`);

    const imported = pending.map((row) => ({ ...row, id: randomUUID() }));
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(BizContractEntity, imported.map((row) => ({
        id: row.id,
        contractNo: row.contractNo,
        contractName: row.contractName,
        taxInclusiveAmountFen: row.taxInclusiveAmountFen,
        taxExclusiveAmountFen: null,
        provinceId: row.provinceId,
        startDate: row.startDate ?? null,
        endDate: row.endDate ?? null,
        status: ContractStatus.DRAFT,
        tags: [],
        amountLocked: false,
        parentContractId: null,
        versionNo: 1,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })));
      await manager.insert(BizOperationLogEntity, imported.map((row) => ({
        id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import',
        targetType: 'contract', targetId: row.id, resultStatus: 'success',
      })));
    });
    return { created: pending.length, contractNos: pending.map((row) => row.contractNo) };
  }

  async importWorkbookWithAllocations(auth: BizAuthContext, filename: string, buffer: Buffer): Promise<{ created: number; contractNos: string[]; allocations: number; feeRates: number; issues: string[] }> {
    if (!filename.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('仅支持 .xlsx 合同文件');
    if (!['super_admin', 'admin', 'contract_manager'].includes(auth.roleCode)) throw new ForbiddenException('当前账号无合同导入权限');

    const workbook = readWorkbookSafe(buffer, { maxRowsPerSheet: WORKBOOK_LIMITS.maxRowsPerSheet });
    if (workbook.SheetNames.length !== 1) throw new BadRequestException('合同导入文件必须包含一个工作表');
    const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '' });
    const header = (sourceRows[0] ?? []).map((value) => String(value).trim());
    const indexOf = (aliases: string[]) => header.findIndex((value) => aliases.includes(this.normalizeImportHeader(value)));
    const indexes = {
      province: indexOf(['省份名称', '所属省份', '省份']),
      city: indexOf(['地市名称', '地市', '市公司']),
      contractNo: indexOf(['合同编号', '合同号']),
      contractName: indexOf(['合同名称', '合同名']),
      amount: indexOf(['合同含税金额', '合同含税总额（元）', '含税合同额（元）', '含税合同额', '合同金额（元）', '合同金额']),
      period: indexOf(['合同期限', '合同日期', '合同起止日期']),
      startDate: indexOf(['开始日期', '合同开始日期']),
      endDate: indexOf(['结束日期', '合同结束日期']),
      rate: indexOf(['管理费比例', '管理费率', '费率']),
    };
    const missing = Object.entries(indexes).filter(([key, value]) => ['province', 'city', 'contractNo', 'contractName', 'amount', 'rate'].includes(key) && value < 0).map(([key]) => key);
    if (missing.length) throw new BadRequestException(`缺少合同导入必填列：${missing.join('、')}`);

    const provinceByKey = new Map<string, string>();
    for (const province of await this.provinceRepo.find()) {
      provinceByKey.set(this.normalizeAreaName(province.name), province.id);
      provinceByKey.set(province.code.trim(), province.id);
    }
    const cityByKey = new Map<string, CityEntity>();
    for (const city of await this.cityRepo.find()) {
      cityByKey.set(`${city.provinceId}:${this.normalizeAreaName(city.name)}`, city);
      cityByKey.set(`${city.provinceId}:${city.code.trim()}`, city);
    }

    type ImportRow = { rowNo: number; contractNo: string; contractName: string; amountFen: number; provinceId: string; cityId?: string; rateBp?: number; startDate: string | null; endDate: string | null };
    const rows: ImportRow[] = [];
    const errors: string[] = [];
    const issues: string[] = [];
    sourceRows.slice(1).forEach((source, offset) => {
      const values = Array.isArray(source) ? source : [];
      if (values.every((value) => String(value ?? '').trim() === '')) return;
      const read = (index: number) => index < 0 ? '' : String(values[index] ?? '').trim();
      const rowNo = offset + 2;
      const provinceText = read(indexes.province);
      const cityText = read(indexes.city);
      const amountText = read(indexes.amount).replace(/[￥¥元,，]/g, '').trim();
      const rateText = read(indexes.rate).replace(/％/g, '%').trim();
      const provinceId = provinceByKey.get(this.normalizeAreaName(provinceText));
      const city = provinceId ? cityByKey.get(`${provinceId}:${this.normalizeAreaName(cityText)}`) : undefined;
      const amount = Number(amountText);
      const rateBp = this.parseImportRate(rateText);
      const period = this.parseImportPeriod(read(indexes.period));
      const startDate = this.normalizeContractDate(read(indexes.startDate)) ?? period.startDate;
      const endDate = this.normalizeContractDate(read(indexes.endDate)) ?? period.endDate;
      const contractNo = read(indexes.contractNo);
      const contractName = read(indexes.contractName);
      const rowErrors: string[] = [];
      const rowIssues: string[] = [];
      if (!contractNo) rowErrors.push('合同编号为空');
      if (!contractName) rowErrors.push('合同名称为空');
      if (!provinceId) rowErrors.push(`省份无法匹配：${provinceText || '空'}`);
      if (!Number.isFinite(amount) || amount < 0) rowErrors.push(`含税金额无效：${amountText || '空'}`);
      if (!city) rowIssues.push(`地市无法匹配：${cityText || '空'}（省级公司不能替代具体地市）`);
      if (rateBp == null) rowIssues.push(`管理费率无效：${rateText || '空'}`);
      if ((read(indexes.startDate) && !startDate) || (read(indexes.endDate) && !endDate) || (read(indexes.period) && !startDate && !endDate)) rowIssues.push('合同期限无法解析，需在生效前补充起止日期');
      if (rowErrors.length) {
        errors.push(`第 ${rowNo} 行：${rowErrors.join('；')}`);
        return;
      }
      if (rowIssues.length) issues.push(`第 ${rowNo} 行：${rowIssues.join('；')}`);
      rows.push({ rowNo, contractNo, contractName, amountFen: Math.round(amount * 100), provinceId: provinceId as string, cityId: city?.id, rateBp: rateBp ?? undefined, startDate, endDate });
    });
    if (!rows.length && !errors.length) throw new BadRequestException('合同导入文件没有数据行');
    if (errors.length && !rows.length) throw new BadRequestException(errors.slice(0, 20).join('；'));
    issues.push(...errors);

    const grouped = new Map<string, ImportRow[]>();
    for (const row of rows) grouped.set(row.contractNo, [...(grouped.get(row.contractNo) ?? []), row]);
    const existing = await this.contractRepo.findBy({ contractNo: In([...grouped.keys()]) });
    for (const contract of existing) {
      grouped.delete(contract.contractNo);
      issues.push(`合同编号 ${contract.contractNo} 已存在，本次未重复导入`);
    }

    const contracts = [...grouped.entries()].map(([contractNo, contractRows]) => {
      const first = contractRows[0];
      if (contractRows.some((row) => row.contractName !== first.contractName || row.provinceId !== first.provinceId || row.startDate !== first.startDate || row.endDate !== first.endDate)) {
        issues.push(`合同编号 ${contractNo} 的名称、省份或期限不一致，已按首行基础信息保存，需管理员核对`);
      }
      const cityRates = new Map<string, number>();
      for (const row of contractRows) {
        if (!row.cityId || row.rateBp == null) continue;
        const existingRate = cityRates.get(row.cityId);
        if (existingRate != null && existingRate !== row.rateBp) issues.push(`合同编号 ${contractNo} 同一地市存在不同管理费率，已保留首个费率`);
        else cityRates.set(row.cityId, row.rateBp);
      }
      return { id: randomUUID(), first, contractRows, amountFen: contractRows.reduce((sum, row) => sum + row.amountFen, 0) };
    });
    let allocationCount = 0;
    let feeRateCount = 0;
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(BizContractEntity, contracts.map(({ id, first, amountFen }) => ({ id, contractNo: first.contractNo, contractName: first.contractName, taxInclusiveAmountFen: amountFen, taxExclusiveAmountFen: null, provinceId: first.provinceId, startDate: first.startDate, endDate: first.endDate, status: ContractStatus.DRAFT, tags: [], amountLocked: false, parentContractId: null, versionNo: 1, createdBy: auth.userId, updatedBy: auth.userId })));
      const allocations = contracts.flatMap(({ id, contractRows }) => {
        const quotaByCity = new Map<string, number>();
        for (const row of contractRows) if (row.cityId) quotaByCity.set(row.cityId, (quotaByCity.get(row.cityId) ?? 0) + row.amountFen);
        return [...quotaByCity.entries()].map(([cityId, quotaFen]) => ({ id: randomUUID(), contractId: id, cityId, quotaFen, status: 'active', versionNo: 1 }));
      });
      const rates = contracts.flatMap(({ id, contractRows, first }) => {
        const rateByCity = new Map<string, number>();
        for (const row of contractRows) if (row.cityId && row.rateBp != null && !rateByCity.has(row.cityId)) rateByCity.set(row.cityId, row.rateBp);
        return [...rateByCity.entries()].map(([cityId, rateBp]) => ({ id: randomUUID(), contractId: id, cityId, effectiveMonth: first.startDate?.slice(0, 7) ?? '2026-01', rateBp, changeReason: 'Excel导入' }));
      });
      allocationCount = allocations.length;
      feeRateCount = rates.length;
      if (allocations.length) await manager.insert(BizContractCityAllocationEntity, allocations);
      if (rates.length) await manager.insert(BizContractFeeRateEntity, rates);
      await manager.insert(BizOperationLogEntity, contracts.map(({ id }) => ({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import', targetType: 'contract', targetId: id, resultStatus: 'success' })));
    });
    return { created: contracts.length, contractNos: contracts.map(({ first }) => first.contractNo), allocations: allocationCount, feeRates: feeRateCount, issues };
  }

  async batchClearDrafts(auth: BizAuthContext, ids: string[]): Promise<{ cleared: number; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份合同');
    const contracts = await this.contractRepo.findBy({ id: In(uniqueIds) });
    const byId = new Map(contracts.map((contract) => [contract.id, contract]));
    const skipped: Array<{ id: string; contractNo?: string; reason: string }> = [];
    const clearIds: string[] = [];
    for (const id of uniqueIds) {
      const contract = byId.get(id);
      if (!contract) { skipped.push({ id, reason: '合同不存在' }); continue; }
      if (contract.status !== ContractStatus.DRAFT) { skipped.push({ id, contractNo: contract.contractNo, reason: '仅能清空草稿合同' }); continue; }
      const [orders, completions] = await Promise.all([this.orderRowRepo.countBy({ contractId: id }), this.offlineRepo.countBy({ contractId: id })]);
      if (orders || completions) { skipped.push({ id, contractNo: contract.contractNo, reason: '合同已有订单或线下完工，不能清空' }); continue; }
      clearIds.push(id);
    }
    if (clearIds.length) await this.dataSource.transaction(async (manager) => {
      await manager.delete(BizContractFeeRateEntity, { contractId: In(clearIds) });
      await manager.delete(BizContractCityAllocationEntity, { contractId: In(clearIds) });
      await manager.delete(BizContractAlertEntity, { contractId: In(clearIds) });
      await manager.delete(BizOperationLogEntity, { targetType: 'contract', targetId: In(clearIds) });
      await manager.delete(BizContractEntity, { id: In(clearIds) });
      await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.batch_clear_drafts', targetType: 'contract_batch', targetId: randomUUID(), resultStatus: 'success' });
    });
    return { cleared: clearIds.length, skipped };
  }

  private normalizeImportHeader(value: string): string {
    return value.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
  }

  private normalizeAreaName(value: string): string {
    return value.trim().replace(/\s/g, '').replace(/分公司$/, '').replace(/公司$/, '').replace(/市$/, '').replace(/省$/, '');
  }

  private parseImportRate(value: string): number | null {
    const text = value.trim().replace(/,/g, '');
    if (!text) return null;
    const numeric = Number(text.replace(/%$/, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const percent = text.endsWith('%') ? numeric : numeric <= 1 ? numeric * 100 : numeric;
    if (percent > 100) return null;
    return Math.round(percent * 100);
  }

  private parseImportPeriod(value: string): { startDate: string | null; endDate: string | null } {
    const matches = value.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g) ?? [];
    return { startDate: this.normalizeContractDate(matches[0] ?? ''), endDate: this.normalizeContractDate(matches[1] ?? '') };
  }

  private contractImportIndexes(header: string[]): Map<string, number> {
    const aliases: Record<string, string[]> = {
      '合同编号': ['合同编号', '合同号'],
      '合同名称': ['合同名称', '合同名'],
      '含税合同额（元）': ['含税合同额（元）', '含税合同额(元)', '含税合同额', '合同金额（元）', '合同金额'],
      '所属省份': ['所属省份', '省份', '省份名称'],
      '开始日期': ['开始日期', '合同开始日期'],
      '结束日期': ['结束日期', '合同结束日期'],
    };
    const normalize = (value: string) => value.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
    const normalized = header.map(normalize);
    return new Map(Object.entries(aliases).flatMap(([field, names]) => {
      const index = normalized.findIndex((value) => names.some((name) => value === normalize(name)));
      return index < 0 ? [] : [[field, index] as const];
    }));
  }

  private normalizeContractDate(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value.replace(/[/.]/g, '-'));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
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
  private async completenessIssues(contract: BizContractEntity): Promise<string[]> {
    const missing: string[] = [];
    if (!contract.contractNo?.trim()) missing.push('合同编号');
    if (!contract.contractName?.trim()) missing.push('合同名称');
    if (!Number(contract.taxInclusiveAmountFen) || Number(contract.taxInclusiveAmountFen) <= 0) missing.push('含税合同金额(>0)');
    if (!contract.startDate) missing.push('合同开始日期');
    if (!contract.endDate) missing.push('合同结束日期');
    if (missing.length) return missing;

    const allocations = await this.allocationRepo.findBy({ contractId: contract.id, status: 'active' });
    if (allocations.length === 0) throw new BadRequestException('合同资料不完整，缺少：地市分配');
    for (const alloc of allocations) {
      const rate = await this.feeRateRepo.findOneBy({
        contractId: contract.id, cityId: alloc.cityId,
      });
      if (!rate) missing.push(`地市费率(${alloc.cityId})`);
    }
    return missing;
  }

  private async assertCompleteness(contract: BizContractEntity): Promise<void> {
    const missing = await this.completenessIssues(contract);
    if (missing.length) throw new BadRequestException(`合同资料不完整，缺少：${missing.join('、')}`);
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

  async batchActivate(auth: BizAuthContext, ids: string[], dryRun = false): Promise<{ checked: number; activated: string[]; failed: Array<{ id: string; contractNo?: string; reason: string }> }> {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份草稿合同');
    const activated: string[] = [];
    const failed: Array<{ id: string; contractNo?: string; reason: string }> = [];
    for (const id of uniqueIds) {
      const contract = await this.contractRepo.findOneBy({ id });
      if (!contract) { failed.push({ id, reason: '合同不存在' }); continue; }
      if (contract.status !== ContractStatus.DRAFT) { failed.push({ id, contractNo: contract.contractNo, reason: '仅草稿合同可生效' }); continue; }
      const issues = await this.completenessIssues(contract);
      if (issues.length) { failed.push({ id, contractNo: contract.contractNo, reason: `合同资料不完整，缺少：${issues.join('、')}` }); continue; }
      if (dryRun) { activated.push(id); continue; }
      contract.status = ContractStatus.ACTIVE;
      contract.amountLocked = true;
      contract.versionNo += 1;
      contract.updatedBy = auth.userId;
      await this.contractRepo.save(contract);
      await this.recordOp(auth.userId, 'contract.activate', id);
      activated.push(id);
    }
    return { checked: uniqueIds.length, activated, failed };
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

  /** 合同维度财务参考（成本不关联合同：按分配地市汇总为【参考值】，一市多合同会重复计入，不用于净利润口径） */
  private async financeForContract(contract: BizContractEntity, visibleCityIds?: Set<string> | null): Promise<{ referenceCostFen: number; grossProfitFen: number; referenceNetProfitFen: number; isReference: boolean }> {
    const inScope = (cityId: string | null | undefined) => !visibleCityIds || (cityId != null && visibleCityIds.has(cityId));
    const allocations = (await this.allocationRepo.findBy({ contractId: contract.id, status: 'active' })).filter((a) => inScope(a.cityId));
    const cityIds = allocations.map((a) => a.cityId);
    let costFen = 0;
    if (cityIds.length > 0) {
      const costs = await this.costRepo.createQueryBuilder('c')
        .select('SUM(c.amountFen)', 'total')
        .where('c.status = :status', { status: 'approved' })
        .andWhere('c.cityId IN (:...cityIds)', { cityIds })
        .getRawOne();
      costFen = Number(costs?.total ?? 0);
    }
    const orders = (await this.orderRowRepo.findBy({ contractId: contract.id, isVoid: false, validationStatus: 'valid' })).filter((o) => inScope(o.cityId));
    const offlines = (await this.offlineRepo.findBy({ contractId: contract.id, status: 'approved' })).filter((o) => inScope(o.cityId));
    const grossProfitFen = orders.reduce((s, o) => s + (Number(o.grossProfitFen) || 0), 0)
      + offlines.reduce((s, o) => s + (Number(o.grossProfitFen) || 0), 0);
    return { referenceCostFen: costFen, grossProfitFen, referenceNetProfitFen: grossProfitFen - costFen, isReference: true };
  }

  /** 生成/更新合同预警（nearly_full / overfull / expiring / expired；到期阈值来自系统设置） */
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
      const setting = await this.settingRepo.findOneBy({ settingKey: 'contract_expiry_warning_days' });
      const warningDays = Number(setting?.settingValue ?? 90);
      const thresholdMs = warningDays * 24 * 3600 * 1000;
      if (end.getTime() - now.getTime() <= thresholdMs && end.getTime() >= now.getTime() - 24 * 3600 * 1000) tags.push(ContractTag.EXPIRING);
      if (end < new Date(today)) tags.push(ContractTag.EXPIRED);
    }
    contract.tags = tags;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
  }
}
