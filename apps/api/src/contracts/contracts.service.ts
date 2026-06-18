import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ContractEntity } from './contract.entity';
import { AllocationEntity } from './allocation.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import type {
  CreateContractRequest,
  UpdateContractRequest,
  CreateAllocationRequest,
  UpdateAllocationRequest,
  PaginatedResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';

/**
 * 合同管理核心服务
 *
 * 职责:
 * - 合同 CRUD + 软删除
 * - 合同跨地市分配管理（CRUD）
 * - 分页查询 + 搜索
 *
 * TODO (后续 WS):
 * - 导入/导出 Excel
 * - 累计金额自动同步逻辑
 */
@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepository: Repository<AllocationEntity>,
  ) {}

  // ============================================================
  // 合同 CRUD
  // ============================================================

  /**
   * 分页查询合同列表（排除软删除）
   */
  async list(params: PaginationParams): Promise<PaginatedResponse<any>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const keyword = (params as any).keyword; // 可选搜索关键词

    const qb = this.contractRepository.createQueryBuilder('c')
      .where('c.is_deleted = :deleted', { deleted: SoftDeleteFlag.NOT_DELETED });

    if (keyword) {
      qb.andWhere(
        '(c.contract_code LIKE :kw OR c.contract_name LIKE :kw)',
        { kw: `%${keyword}%` },
      );
    }

    const [items, total] = await qb
      .orderBy('c.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: items.map((c) => this.toContractDTO(c)),
      total,
      page,
      pageSize,
    };
  }

  /** 查找单个合同 */
  async findOne(id: number) {
    const contract = await this.contractRepository.findOne({
      where: { id, isDeleted: SoftDeleteFlag.NOT_DELETED },
    });
    if (!contract) {
      throw new NotFoundException(`合同 #${id} 不存在`);
    }
    return this.toContractDTO(contract);
  }

  /** 创建新合同 */
  async create(dto: CreateContractRequest): Promise<any> {
    // 检查合同编码唯一性
    const existing = await this.contractRepository.findOne({
      where: { contractCode: dto.contractCode },
    });
    if (existing && !existing.isDeleted) {
      throw new BadRequestException(`合同编码 ${dto.contractCode} 已存在`);
    }

    const contract = this.contractRepository.create({
      contractCode: dto.contractCode,
      contractName: dto.contractName,
      contractAmount: dto.contractAmount,
      rate: dto.rate || 0,
      signDate: dto.signDate || null,
      expireDate: dto.expireDate || null,
      isDeleted: SoftDeleteFlag.NOT_DELETED,
      createdBy: 0, // TODO: 从当前用户获取
      updatedBy: 0,
    });

    const saved = await this.contractRepository.save(contract);
    return this.toContractDTO(saved);
  }

  /** 更新合同信息 */
  async update(id: number, dto: UpdateContractRequest): Promise<any> {
    const contract = await this.findOrThrow(id);

    // 更新可变字段
    if (dto.contractName !== undefined) contract.contractName = dto.contractName;
    if (dto.contractAmount !== undefined) contract.contractAmount = dto.contractAmount;
    if (dto.rate !== undefined) contract.rate = dto.rate;
    if (dto.signDate !== undefined) contract.signDate = typeof dto.signDate === 'string' ? new Date(dto.signDate) : dto.signDate;
    if (dto.expireDate !== undefined) contract.expireDate = typeof dto.expireDate === 'string' ? new Date(dto.expireDate) : dto.expireDate;

    const saved = await this.contractRepository.save(contract);
    return this.toContractDTO(saved);
  }

  /**
   * 软删除合同
   *
   * 关键业务规则:
   * - 仅标记 is_deleted=1 + deleted_at
   * - 不删除物理数据，已有月度快照中的快照数据不受影响
   */
  async softDelete(id: number): Promise<{ success: boolean; message: string }> {
    const contract = await this.findOrThrow(id);

    if (contract.isDeleted === SoftDeleteFlag.DELETED) {
      throw new BadRequestException('该合同已被软删除');
    }

    await this.contractRepository.update(id, {
      isDeleted: SoftDeleteFlag.DELETED,
      deletedAt: new Date(),
    });

    return { success: true, message: `合同 ${contract.contractCode} 已软删除，历史快照不受影响` };
  }

  // ============================================================
  // 分配管理
  // ============================================================

  /** 获取指定合同的所有城市分配 */
  async listAllocations(contractId: number): Promise<any[]> {
    await this.findOrThrow(contractId); // 校验合同存在

    const allocations = await this.allocationRepository.find({
      where: { contractId },
      order: { cityId: 'ASC' },
    });

    return allocations.map((a) => this.toAllocationDTO(a));
  }

  /** 新增城市分配 */
  async createAllocation(dto: CreateAllocationRequest): Promise<any> {
    // 检查唯一约束
    const existing = await this.allocationRepository.findOne({
      where: { contractId: dto.contractId, cityId: dto.cityId },
    });
    if (existing) {
      throw new BadRequestException(
        `该合同已分配给城市 #${dto.cityId}`,
      );
    }

    // 校验合同存在且未删除
    await this.findOrThrow(dto.contractId);

    const alloc = this.allocationRepository.create({
      contractId: dto.contractId,
      cityId: dto.cityId,
      cityContractAmount: dto.cityContractAmount || 0,
      rate: dto.rate || 0,
    });

    const saved = await this.allocationRepository.save(alloc);
    return this.toAllocationDTO(saved);
  }

  /** 更新分配信息 */
  async updateAllocation(id: number, dto: UpdateAllocationRequest): Promise<any> {
    const alloc = await this.findAllocationOrThrow(id);

    if (dto.cityContractAmount !== undefined) alloc.cityContractAmount = dto.cityContractAmount;
    if (dto.rate !== undefined) alloc.rate = dto.rate;

    const saved = await this.allocationRepository.save(alloc);
    return this.toAllocationDTO(saved);
  }

  /** 删除分配记录 */
  async deleteAllocation(id: number): Promise<{ success: boolean }> {
    const alloc = await this.findAllocationOrThrow(id);
    await this.allocationRepository.remove(alloc);
    return { success: true };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async findOrThrow(id: number): Promise<ContractEntity> {
    const contract = await this.contractRepository.findOne({ where: { id } });
    if (!contract) {
      throw new NotFoundException(`合同 #${id} 不存在`);
    }
    return contract;
  }

  private async findAllocationOrThrow(id: number): Promise<AllocationEntity> {
    const alloc = await this.allocationRepository.findOne({ where: { id } });
    if (!alloc) {
      throw new NotFoundException(`分配记录 #${id} 不存在`);
    }
    return alloc;
  }

  /** Entity → DTO 映射（隐藏内部字段） */
  private toContractDTO(c: ContractEntity) {
    return {
      id: c.id,
      contractCode: c.contractCode,
      contractName: c.contractName,
      contractAmount: c.contractAmount,
      rate: c.rate,
      accumulatedOrderAmount: c.accumulatedOrderAmount,
      accumulatedInvoiceAmount: c.accumulatedInvoiceAmount,
      signDate: c.signDate,
      expireDate: c.expireDate,
      isDeleted: c.isDeleted === SoftDeleteFlag.DELETED,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private toAllocationDTO(a: AllocationEntity) {
    return {
      id: a.id,
      contractId: a.contractId,
      cityId: a.cityId,
      cityContractAmount: a.cityContractAmount,
      rate: a.rate,
      accumulatedOrderAmount: a.accumulatedOrderAmount,
      accumulatedInvoiceAmount: a.accumulatedInvoiceAmount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
