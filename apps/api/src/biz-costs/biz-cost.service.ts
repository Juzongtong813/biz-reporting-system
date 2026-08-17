import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { CostStatus, PlatformRole } from '@biz-reporting/shared-types';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizCostCategoryEntity } from '../costs/biz-cost-category.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { CityEntity } from '../main-data/city.entity';

export interface CostEntryDto {
  cityId: string;
  businessMonth: string; // YYYY-MM
  categoryCode: string;
  amountFen: number;
  description?: string | null;
}

/**
 * 地市成本服务（新基线 M5）
 * 基线：01 §7 / 04 §6 —— 成本独立核算，不关联合同；
 *  - 分类必填且来自字典；金额 >0；月份非未来；
 *  - 审核授权：默认仅 super_admin（operation.cost.approve 通配）；admin 经账号例外授权后也可审核；
 *  - 状态机：draft → submitted → approved / rejected；approved → voided（受权作废/恢复）；
 *  - 乐观锁并发（@VersionColumn）。
 */
@Injectable()
export class BizCostService {
  constructor(
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizCostCategoryEntity)
    private readonly categoryRepo: Repository<BizCostCategoryEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    private readonly rbac: RbacService,
    private readonly aggregates: BizAggregateService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'cost_entry', targetId, resultStatus,
    });
  }

  private async getOrFail(id: string): Promise<BizCostEntryEntity> {
    const item = await this.costRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('成本记录不存在');
    return item;
  }

  /** 地市用户仅本地市 */
  private async assertCityAccess(auth: BizAuthContext, cityId: string | null): Promise<void> {
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无成本数据范围');
    if (auth.roleCode === PlatformRole.CITY_USER) {
      if (cityId !== auth.dataScope.cityId) throw new ForbiddenException('数据范围不足');
    } else if (cityId) {
      await this.rbac.assertCityScope(auth, cityId);
    }
  }

  private async assertRules(dto: CostEntryDto): Promise<void> {
    if (!Number.isFinite(dto.amountFen) || dto.amountFen <= 0) throw new BadRequestException('成本金额必须大于 0');
    if (!/^\d{4}-\d{2}$/.test(dto.businessMonth)) throw new BadRequestException('业务月份格式应为 YYYY-MM');
    const [year, month] = dto.businessMonth.split('-').map(Number);
    const now = new Date();
    if (year * 12 + month > now.getFullYear() * 12 + now.getMonth() + 1) throw new BadRequestException('业务月份不能是未来月份');
    if (!dto.categoryCode?.trim()) throw new BadRequestException('成本分类必填');
    const category = await this.categoryRepo.findOneBy({ code: dto.categoryCode });
    if (!category) throw new BadRequestException('成本分类不存在');
  }

  // ================= 列表/详情 =================

  async list(auth: BizAuthContext, filter: { cityId?: string; status?: string }): Promise<BizCostEntryEntity[]> {
    if (filter.cityId) await this.assertCityAccess(auth, filter.cityId);
    const qb = this.costRepo.createQueryBuilder('c');
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无成本数据范围');
    if (auth.dataScope.scopeType === 'city') qb.andWhere('c.cityId = :scopeCityId', { scopeCityId: auth.dataScope.cityId });
    if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(auth.dataScope.provinceIds) } });
      const cityIds = cities.map((city) => city.id);
      if (cityIds.length === 0) qb.andWhere('1 = 0');
      else qb.andWhere('c.cityId IN (:...scopeCityIds)', { scopeCityIds: cityIds });
    }
    if (filter.cityId) qb.andWhere('c.cityId = :cityId', { cityId: filter.cityId });
    if (filter.status) qb.andWhere('c.status = :status', { status: filter.status });
    return qb.orderBy('c.createdAt', 'DESC').getMany();
  }

  async detail(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    return item;
  }

  // ================= 新增/编辑/提交/撤回 =================

  async create(auth: BizAuthContext, dto: CostEntryDto): Promise<BizCostEntryEntity> {
    await this.assertCityAccess(auth, dto.cityId);
    await this.assertRules(dto);
    const item = await this.costRepo.save({
      id: randomUUID(),
      cityId: dto.cityId,
      businessMonth: dto.businessMonth,
      categoryCode: dto.categoryCode,
      amountFen: Math.round(dto.amountFen),
      description: dto.description ?? null,
      status: CostStatus.DRAFT,
      versionNo: 1,
    });
    await this.recordOp(auth.userId, 'cost.create', item.id);
    return item;
  }

  async update(auth: BizAuthContext, id: string, dto: Partial<CostEntryDto>): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.DRAFT && item.status !== CostStatus.REJECTED) throw new BadRequestException('仅草稿或已驳回记录可编辑');
    const merged: CostEntryDto = {
      cityId: dto.cityId ?? item.cityId,
      businessMonth: dto.businessMonth ?? item.businessMonth,
      categoryCode: dto.categoryCode ?? item.categoryCode,
      amountFen: dto.amountFen ?? Number(item.amountFen),
      description: dto.description ?? item.description,
    };
    await this.assertRules(merged);
    // 新 cityId 范围校验（update 允许改城市时，新城市必须在操作人数据范围内）
    if (merged.cityId !== item.cityId) await this.assertCityAccess(auth, merged.cityId);
    Object.assign(item, {
      cityId: merged.cityId,
      businessMonth: merged.businessMonth,
      categoryCode: merged.categoryCode,
      amountFen: Math.round(merged.amountFen),
      description: merged.description,
    });
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.update', id);
    return item;
  }

  async submit(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.DRAFT && item.status !== CostStatus.REJECTED) throw new BadRequestException('仅草稿或已驳回记录可提交');
    await this.assertRules({
      cityId: item.cityId, businessMonth: item.businessMonth,
      categoryCode: item.categoryCode, amountFen: Number(item.amountFen), description: item.description,
    });
    item.status = CostStatus.PENDING;
    item.submittedBy = auth.userId;
    item.submittedAt = new Date();
    item.reviewerId = null;
    item.reviewedAt = null;
    item.reviewComment = null;
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.submit', id);
    return item;
  }

  async withdraw(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.PENDING) throw new BadRequestException('仅已提交记录可撤回');
    if (!auth.isSuperAdmin && item.submittedBy !== auth.userId) throw new ForbiddenException('仅提交人可撤回');
    item.status = CostStatus.DRAFT;
    item.submittedBy = null;
    item.submittedAt = null;
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.withdraw', id);
    return item;
  }

  // ================= 审核（DEV-043：权限由守卫校验 operation.cost.approve） =================

  async approve(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    if (item.status !== CostStatus.PENDING) throw new BadRequestException('仅已提交记录可审核');
    item.status = CostStatus.APPROVED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = null;
    try {
      await this.costRepo.save(item);
    } catch (error) {
      if (error instanceof Error && error.name === 'OptimisticLockVersionMismatchError') {
        throw new BadRequestException('记录已被他人修改，请刷新后重试');
      }
      throw error;
    }
    await this.recordOp(auth.userId, 'cost.approve', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  async reject(auth: BizAuthContext, id: string, comment: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    if (item.status !== CostStatus.PENDING) throw new BadRequestException('仅已提交记录可驳回');
    if (!comment?.trim()) throw new BadRequestException('驳回原因必填');
    item.status = CostStatus.REJECTED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = comment.trim().slice(0, 500);
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.reject', id);
    return item;
  }

  async voidItem(auth: BizAuthContext, id: string, reason: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    if (item.status !== CostStatus.APPROVED) throw new BadRequestException('仅已审核通过的记录可作废');
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    item.status = CostStatus.VOIDED;
    item.voidedBy = auth.userId;
    item.voidedAt = new Date();
    item.voidReason = reason.trim().slice(0, 255);
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.void', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  async restoreItem(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    if (item.status !== CostStatus.VOIDED) throw new BadRequestException('仅已作废记录可恢复');
    item.status = CostStatus.APPROVED;
    item.voidedBy = null;
    item.voidedAt = null;
    item.voidReason = null;
    await this.costRepo.save(item);
    await this.recordOp(auth.userId, 'cost.restore', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }
}
