/**
 * 经营单元上报系统 - 共享枚举定义
 * 数据来源：biz-reporting-mysql-ddl.sql + biz-reporting-openapi-initial.yaml
 */
export declare enum Role {
    /** 城市用户（微信登录） */
    CITY_USER = "city_user",
    /** 系统管理员（账号密码登录） */
    SYSTEM_ADMIN = "system_admin"
}
export declare enum UserStatus {
    ENABLED = "enabled",
    DISABLED = "disabled"
}
export declare enum PackageStatus {
    /** 草稿态（可编辑） */
    DRAFT = "draft",
    /** 已提交（只读，生成快照） */
    SUBMITTED = "submitted"
}
export declare enum ContractRowLockStatus {
    UNLOCKED = 0,
    LOCKED = 1
}
export declare enum SoftDeleteFlag {
    NOT_DELETED = 0,
    DELETED = 1
}
export declare enum JobStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    COMPLETED = "completed",
    FAILED = "failed"
}
export declare enum ImportJobType {
    CONTRACT = "contract",
    CITY_REPORTING = "city_reporting"
}
export declare enum ExportMode {
    /** 当前实时数据 */
    CURRENT_REALTIME = "current_realtime",
    /** 月度快照数据 */
    MONTH_SNAPSHOT = "month_snapshot"
}
export declare enum ExportScopeType {
    /** 指定城市 */
    CITY = "city",
    /** 所有城市 */
    ALL_CITIES = "all_cities"
}
export declare enum SnapshotRange {
    /** 仅当月 */
    MONTH_ONLY = "month_only",
    /** 年初至当月 */
    YEAR_TO_MONTH = "year_to_month"
}
export declare enum RecalcRetryMode {
    FULL = "full",
    FAILED_ONLY = "failed_only"
}
export declare enum ReminderTriggerType {
    SUBMIT_DEADLINE = "submit_deadline",
    OVERDUE = "overdue",
    CUSTOM = "custom"
}
export declare enum ReminderSendStatus {
    PENDING = "pending",
    SENT = "sent",
    FAILED = "failed"
}
export declare enum MessageType {
    REMINDER = "reminder",
    SUBMIT_SUCCESS = "submit_success",
    RETURN_TO_DRAFT = "return_to_draft",
    SYSTEM_NOTICE = "system_notice"
}
export declare enum CostCategoryCode {
    LABOR = "labor",
    UTILITIES = "utilities",
    FUEL = "fuel",
    ENTERTAINMENT = "entertainment",
    RENT = "rent",
    REIMBURSEMENT = "reimbursement",
    OTHER = "other"
}
export declare const MONTH_MIN = 1;
export declare const MONTH_MAX = 12;
export type MonthNoType = number;
//# sourceMappingURL=index.d.ts.map