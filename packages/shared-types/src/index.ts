/**
 * 经营单元上报系统 - 共享 TypeScript 类型
 * 统一导出入口
 *
 * 使用方式：
 *   import { Role, UserStatus, Contract, DraftSaveRequest } from '@biz-reporting/shared-types';
 */

// 枚举
export * from './enums/index';

// 实体
export { City } from './contract/city';
export type { Contract, ContractCityAllocation } from './contract/contract';
export type { AnnualReportPackage } from './package/annual-package';
export type {
  ReportContractMonthlyRow,
  ReportCostMonthlyRow,
  ReportMaintenanceMonthlyRow,
} from './reporting/monthly-rows';
export type { User, UserBrief } from './user/user';

// 通用实体
export type { Message } from './reminder/message';
export type { MonthUnlockGrant, MonthSnapshot, SnapshotSummaryData } from './common/snapshots';
export type { OperationLog } from './common/operation-log';

// 基础类型
export type { BaseEntity, PaginationParams, PaginatedResponse, ApiResponse, ApiErrorResponse } from './common/base';

// DTO
export type {
  AdminLoginRequest,
  WechatRegisterRequest,
  WechatLoginRequest,
  LoginResponse,
  MeResponse,
} from './common/auth.dto';
export type {
  UserListItem,
  UserListResponse,
  UpdateUserStatusRequest,
  RebindUserCityRequest,
} from './user/user.dto';
export type {
  CreateContractRequest,
  UpdateContractRequest,
  CreateAllocationRequest,
  UpdateAllocationRequest,
} from './contract/contract.dto';
export type {
  ContractMonthInput,
  CostMonthInput,
  MaintenanceMonthInput,
  DraftSaveRequest,
  SubmitPreviewResponse,
  SubmitMonthRequest,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  OpenCurrentMonthContractRequest,
} from './reporting/reporting.dto';
export type { DashboardStats } from './common/dashboard.dto';
export type { CityConfigDto } from './common/city-config.dto';
export type {
  OperationLogListRequest,
  OperationLogListResponse,
} from './common/operation-log.dto';
export type { AdminPackageItem } from './package/admin-package.dto';
export type {
  SendRemindersRequest,
  ConfirmImportRequest,
  CreateExportJobRequest,
  RetryRecalcTaskRequest,
} from './common/misc.dto';
