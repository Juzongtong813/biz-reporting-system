"use strict";
/**
 * 经营单元上报系统 - 共享枚举定义
 * 数据来源：biz-reporting-mysql-ddl.sql + biz-reporting-openapi-initial.yaml
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONTH_MAX = exports.MONTH_MIN = exports.CostCategoryCode = exports.MessageType = exports.ReminderSendStatus = exports.ReminderTriggerType = exports.RecalcRetryMode = exports.SnapshotRange = exports.ExportScopeType = exports.ExportMode = exports.ImportJobType = exports.JobStatus = exports.SoftDeleteFlag = exports.ContractRowLockStatus = exports.PackageStatus = exports.UserStatus = exports.Role = void 0;
// ============================================================
// 角色枚举（来自 OpenAPI schemas.Role）
// ============================================================
var Role;
(function (Role) {
    /** 城市用户（微信登录） */
    Role["CITY_USER"] = "city_user";
    /** 系统管理员（账号密码登录） */
    Role["SYSTEM_ADMIN"] = "system_admin";
})(Role || (exports.Role = Role = {}));
// ============================================================
// 用户状态枚举（来自 OpenAPI schemas.UserStatus + DDL users.status）
// ============================================================
var UserStatus;
(function (UserStatus) {
    UserStatus["ENABLED"] = "enabled";
    UserStatus["DISABLED"] = "disabled";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
// ============================================================
// 年度报表包状态枚举（来自 OpenAPI schemas.PackageStatus + DDL annual_report_packages.status）
// ============================================================
var PackageStatus;
(function (PackageStatus) {
    /** 草稿态（可编辑） */
    PackageStatus["DRAFT"] = "draft";
    /** 已提交（只读，生成快照） */
    PackageStatus["SUBMITTED"] = "submitted";
})(PackageStatus || (exports.PackageStatus = PackageStatus = {}));
// ============================================================
// 合同行锁定状态（来自 DDL report_contract_monthly_rows.is_locked）
// ============================================================
var ContractRowLockStatus;
(function (ContractRowLockStatus) {
    ContractRowLockStatus[ContractRowLockStatus["UNLOCKED"] = 0] = "UNLOCKED";
    ContractRowLockStatus[ContractRowLockStatus["LOCKED"] = 1] = "LOCKED";
})(ContractRowLockStatus || (exports.ContractRowLockStatus = ContractRowLockStatus = {}));
// ============================================================
// 软删除标记（来自 DDL contracts.is_deleted）
// ============================================================
var SoftDeleteFlag;
(function (SoftDeleteFlag) {
    SoftDeleteFlag[SoftDeleteFlag["NOT_DELETED"] = 0] = "NOT_DELETED";
    SoftDeleteFlag[SoftDeleteFlag["DELETED"] = 1] = "DELETED";
})(SoftDeleteFlag || (exports.SoftDeleteFlag = SoftDeleteFlag = {}));
// ============================================================
// 导入/导出/重算任务状态（通用，来自 DDL 各 *_jobs / recalc_tasks .status 字段）
// ============================================================
var JobStatus;
(function (JobStatus) {
    JobStatus["PENDING"] = "pending";
    JobStatus["PROCESSING"] = "processing";
    JobStatus["COMPLETED"] = "completed";
    JobStatus["FAILED"] = "failed";
})(JobStatus || (exports.JobStatus = JobStatus = {}));
// ============================================================
// 导入任务类型（来自 DDL import_jobs.job_type）
// ============================================================
var ImportJobType;
(function (ImportJobType) {
    ImportJobType["CONTRACT"] = "contract";
    ImportJobType["CITY_REPORTING"] = "city_reporting";
})(ImportJobType || (exports.ImportJobType = ImportJobType = {}));
// ============================================================
// 导出模式（来自 OpenAPI CreateExportJobRequest.exportMode）
// ============================================================
var ExportMode;
(function (ExportMode) {
    /** 当前实时数据 */
    ExportMode["CURRENT_REALTIME"] = "current_realtime";
    /** 月度快照数据 */
    ExportMode["MONTH_SNAPSHOT"] = "month_snapshot";
})(ExportMode || (exports.ExportMode = ExportMode = {}));
// ============================================================
// 导出范围类型（来自 OpenAPI CreateExportJobRequest.scopeType）
// ============================================================
var ExportScopeType;
(function (ExportScopeType) {
    /** 指定城市 */
    ExportScopeType["CITY"] = "city";
    /** 所有城市 */
    ExportScopeType["ALL_CITIES"] = "all_cities";
})(ExportScopeType || (exports.ExportScopeType = ExportScopeType = {}));
// ============================================================
// 快照范围（来自 OpenAPI CreateExportJobRequest.snapshotRange）
// ============================================================
var SnapshotRange;
(function (SnapshotRange) {
    /** 仅当月 */
    SnapshotRange["MONTH_ONLY"] = "month_only";
    /** 年初至当月 */
    SnapshotRange["YEAR_TO_MONTH"] = "year_to_month";
})(SnapshotRange || (exports.SnapshotRange = SnapshotRange = {}));
// ============================================================
// 重算模式（来自 OpenAPI RetryRecalcTaskRequest.retryMode）
// ============================================================
var RecalcRetryMode;
(function (RecalcRetryMode) {
    RecalcRetryMode["FULL"] = "full";
    RecalcRetryMode["FAILED_ONLY"] = "failed_only";
})(RecalcRetryMode || (exports.RecalcRetryMode = RecalcRetryMode = {}));
// ============================================================
// 提醒触发类型（冻结值，来自 DDL reminder_logs.trigger_type）
// ============================================================
var ReminderTriggerType;
(function (ReminderTriggerType) {
    ReminderTriggerType["SUBMIT_DEADLINE"] = "submit_deadline";
    ReminderTriggerType["OVERDUE"] = "overdue";
    ReminderTriggerType["CUSTOM"] = "custom";
})(ReminderTriggerType || (exports.ReminderTriggerType = ReminderTriggerType = {}));
// ============================================================
// 提醒发送状态（来自 DDL reminder_logs.status）
// ============================================================
var ReminderSendStatus;
(function (ReminderSendStatus) {
    ReminderSendStatus["PENDING"] = "pending";
    ReminderSendStatus["SENT"] = "sent";
    ReminderSendStatus["FAILED"] = "failed";
})(ReminderSendStatus || (exports.ReminderSendStatus = ReminderSendStatus = {}));
// ============================================================
// 消息类型（冻结值，来自 DDL messages.message_type）
// ============================================================
var MessageType;
(function (MessageType) {
    MessageType["REMINDER"] = "reminder";
    MessageType["SUBMIT_SUCCESS"] = "submit_success";
    MessageType["RETURN_TO_DRAFT"] = "return_to_draft";
    MessageType["SYSTEM_NOTICE"] = "system_notice";
})(MessageType || (exports.MessageType = MessageType = {}));
// ============================================================
// 费用类别代码（7 大固定类别 — 冻结值，来自业务规则 + DDL report_cost_monthly_rows.cost_category_code）
// ============================================================
var CostCategoryCode;
(function (CostCategoryCode) {
    CostCategoryCode["LABOR"] = "labor";
    CostCategoryCode["UTILITIES"] = "utilities";
    CostCategoryCode["FUEL"] = "fuel";
    CostCategoryCode["ENTERTAINMENT"] = "entertainment";
    CostCategoryCode["RENT"] = "rent";
    CostCategoryCode["REIMBURSEMENT"] = "reimbursement";
    CostCategoryCode["OTHER"] = "other";
})(CostCategoryCode || (exports.CostCategoryCode = CostCategoryCode = {}));
// ============================================================
// 月份数值约束（业务规则）
// ============================================================
exports.MONTH_MIN = 1;
exports.MONTH_MAX = 12;
//# sourceMappingURL=index.js.map