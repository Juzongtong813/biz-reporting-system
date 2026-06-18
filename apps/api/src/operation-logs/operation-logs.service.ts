import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { OperationLogListRequest, OperationLogListResponse } from '@biz-reporting/shared-types';

@Injectable()
export class OperationLogsService {
  constructor(
    @InjectRepository(OperationLogEntity)
    private readonly repo: Repository<OperationLogEntity>,
  ) {}

  async list(params: OperationLogListRequest): Promise<OperationLogListResponse> {
    const { page = 1, pageSize = 20, ...filters } = params;

    const query = this.repo
      .createQueryBuilder('log')
      .leftJoin('users', 'u', 'u.id = log.operatorUserId')
      .leftJoin('cities', 'c', 'c.id = log.operatorCityId')
      .select([
        'log.id AS id',
        'log.operatorUserId AS operatorUserId',
        'log.operatorCityId AS operatorCityId',
        'log.actionType AS actionType',
        'log.targetType AS targetType',
        'log.targetId AS targetId',
        'log.summaryText AS summaryText',
        'log.resultStatus AS resultStatus',
        'log.createdAt AS createdAt',
        'u.name AS operatorName',
        'c.name AS operatorCityName',
      ]);

    // actionType 筛选
    if (filters.actionType) {
      query.andWhere('log.actionType = :actionType', { actionType: filters.actionType });
    }

    // targetType 筛选
    if (filters.targetType) {
      query.andWhere('log.targetType = :targetType', { targetType: filters.targetType });
    }

    // operatorUserId 筛选
    if (filters.operatorUserId) {
      query.andWhere('log.operatorUserId = :operatorUserId', { operatorUserId: filters.operatorUserId });
    }

    // cityId 筛选
    if (filters.cityId) {
      query.andWhere('log.operatorCityId = :cityId', { cityId: filters.cityId });
    }

    // 日期范围筛选
    if (filters.dateFrom || filters.dateTo) {
      if (filters.dateFrom && filters.dateTo) {
        query.andWhere('log.createdAt BETWEEN :dateFrom AND :dateTo', {
          dateFrom: new Date(filters.dateFrom),
          dateTo: new Date(filters.dateTo),
        });
      } else if (filters.dateFrom) {
        query.andWhere('log.createdAt >= :dateFrom', { dateFrom: new Date(filters.dateFrom) });
      } else if (filters.dateTo) {
        query.andWhere('log.createdAt <= :dateTo', { dateTo: new Date(filters.dateTo) });
      }
    }

    // 按时间倒序排列
    query.orderBy('log.createdAt', 'DESC');

    // 分页
    const skip = (page - 1) * pageSize;
    query.skip(skip).take(pageSize);

    // 先查总数（去掉分页的独立查询）
    // 注意：select 会影响 count, 所以单独查 count
    const total = await query.getCount();
    const rawItems = await query.getRawMany();

    const items = rawItems.map(row => ({
      id: row.id,
      operatorUserId: row.operatorUserId,
      operatorCityId: row.operatorCityId,
      actionType: row.actionType,
      targetType: row.targetType,
      targetId: row.targetId,
      summaryText: row.summaryText,
      resultStatus: row.resultStatus,
      createdAt: row.createdAt,
      operatorName: row.operatorName || null,
      operatorCityName: row.operatorCityName || null,
    }));

    return { items, total, page, pageSize };
  }
}