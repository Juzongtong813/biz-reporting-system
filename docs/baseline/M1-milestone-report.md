# M1 数据基础里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-14
> 阶段：M1「数据基础」
> 结论：**M1 模型层完成（SQLite 全验证通过）；真实 MySQL 验证 BLOCKED（BLK-1），不形成发布候选**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-005 | 省份、地市标准字典 + UUID（不写死山东） | ✅ 完成 |
| DEV-006 | 用户/角色/权限/模块/账号例外/数据范围模型 + 四角色固化 | ✅ 完成 |
| DEV-007 | 合同表重构（UUID、合同号唯一、整数分、状态机字段、父合同、版本） | ✅ 完成 |
| DEV-008 | 合同-地市分配 + 固定额度 + 费率历史 + 合同预警模型 | ✅ 完成 |
| DEV-009 | 订单批次 + 34 列原始行 + 标准化字段 + 金额分 + 费率快照 + 超额标识 | ✅ 完成 |
| DEV-010 | 线下完工 + 月度成本 + 成本分类 + 审核状态模型（成本不关联合同） | ✅ 完成 |
| DEV-011 | 月度汇总 + 汇总异常 + 重算任务 + 站内消息 + 最小操作日志 | ✅ 完成 |
| DEV-012 | 追加式迁移 010/011 + 索引 + 空库初始化 + 测试种子 + 幂等验证 + checksum 更新 | ✅ 完成（SQLite）／BLOCKED（真实 MySQL） |

## 2. 修改文件（25 项）

### 新增（21）
- 共享层：`packages/shared-types/src/baseline/enums.ts`（PlatformRole/ContractStatus/OrderBatchStatus/OfflineCompletionStatus/CostStatus/OverrunFlag/ContractAlertType/VoidSummaryChoice 等）、`baseline/order-template.ts`（34 列常量/F 列/敏感列/50MB/20万行约束）
- 主数据：`apps/api/src/main-data/province.entity.ts`、`city.entity.ts`、`city-alias.entity.ts`
- 权限：`apps/api/src/rbac/platform-user.entity.ts`、`module.entity.ts`、`role.entity.ts`、`permission.entity.ts`、`role-permission.entity.ts`、`user-permission-override.entity.ts`、`user-data-scope.entity.ts`
- 合同域：`apps/api/src/contracts/biz-contract.entity.ts`、`biz-contract-city-allocation.entity.ts`、`biz-contract-fee-rate.entity.ts`、`biz-contract-alert.entity.ts`
- 订单域：`apps/api/src/orders/biz-order-import-batch.entity.ts`、`biz-order-row.entity.ts`、`biz-order-import-error.entity.ts`
- 完工/成本：`apps/api/src/completions/biz-offline-completion.entity.ts`、`apps/api/src/costs/biz-cost-entry.entity.ts`、`biz-cost-category.entity.ts`
- 汇总/消息/日志：`apps/api/src/aggregates/biz-monthly-aggregate.entity.ts`、`biz-aggregate-failure.entity.ts`、`biz-recalc-task.entity.ts`、`apps/api/src/operation-logs/biz-operation-log.entity.ts`、`apps/api/src/reminders/biz-message.entity.ts`
- 迁移：`apps/api/migration/010_biz_baseline_tables.sql`（25 张表）、`011_biz_seed_main_data.sql`（角色/模块/省份/地市/成本分类种子）
- 测试：`scripts/test/run-baseline-data-smoke.mjs`（M1 数据基础 smoke）
- 文档：`docs/baseline/M1-milestone-report.md`（本文）

### 修改（4）
- `packages/shared-types/src/index.ts`：导出 baseline 枚举与 34 列常量
- `scripts/db/migrate.mjs`：inspectState 追加 010/011 状态检查（工具脚本，非迁移文件）
- `scripts/db/migration-checksums.json`：追加 010/011 SHA-256（不修改既有条目）
- `scripts/test/run-migration-ledger-contract.mjs`：账本断言 10→12 + biz 表/种子断言
- `scripts/test/run-migrations-mysql.mjs`：expectedVersions 10→12 + 010/011 MySQL 断言（待隔离 MySQL 执行）
- `package.json`：新增 `test:baseline-smoke` 脚本

> 注：`apps/admin-web/vite.config.js|d.ts` 被 `tsc -b` 重新生成（内容与 HEAD 一致，仅行尾噪音），不纳入本次提交。

## 3. 数据库迁移

| 迁移 | 内容 | 状态 |
|---|---|---|
| 010_biz_baseline_tables | 25 张 `biz_` 新基线表（主数据/权限/合同/订单/完工/成本/汇总/消息/日志）+ 独立索引 | ✅ SQLite applied |
| 011_biz_seed_main_data | 4 角色 + 5 模块 + 1 省 + 16 地市 + 7 成本分类（幂等 INSERT-SELECT-WHERE-NOT-EXISTS） | ✅ SQLite applied |

- 迁移账本 checksum 已追加（010: `0ff7c75b…`，011: `007877b1…`），既有 001-009 未动。
- 新表主键统一 UUID（VARCHAR(36)）；金额 BIGINT 整数分；费率 INT 整数基点；业务月份 VARCHAR(7) 'YYYY-MM'。
- 旧表 001-009 保留（兼容期只读），新业务只写 `biz_` 表。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm build`（shared-types/shared-constants/api/admin-web） | ✅ 全通过 |
| `pnpm test:unit`（20 文件） | ✅ 全通过 |
| `pnpm test:architecture` | ✅ 0 违规 |
| `pnpm test:migrations:ledger` | ✅ migrations=12 幂等 + biz 表 24 张 + 种子验证 |
| `pnpm test:baseline-smoke` | ✅ 实体加载 20 个 + 种子 + UUID/整数分/唯一约束 CRUD 闭环 |
| `pnpm migration-files:check` | ✅ 12 迁移 checksum 全部匹配 |
| `pnpm test:auth-v3` | ✅ 全通过（旧权限回归无破坏） |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED：缺隔离 MySQL 8（BLK-1），脚本已更新待执行 |

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用（无 docker-compose/gate）；MySQL 迁移脚本已更新但无法执行 | M1 真实 MySQL 验证、M4 集成测试 |
| BLK-2 | facts-v31 测试 Node24+better-sqlite3 原生崩溃 + 外部参考数据依赖 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | M4 按已确认决策「仅电商版 34 列严格匹配」处理，非电商留待 M4 业务确认 |
| NEW-M1 | `pnpm -r typecheck` 对 api/admin-web 无 typecheck 脚本，shared-constants typecheck 依赖 shared-types 先 build | M2 前补 CI 顺序或 typecheck 脚本 |

## 6. 下一里程碑（M2 账号、权限与两级门户）计划

按基线 09 表 7（DEV-013 ~ DEV-019）：

1. **DEV-013** 登录/密码/5 次锁定 15 分钟/停用失效/会话 2h/12h（复核现有 auth 并接入 biz_users）
2. **DEV-014** 角色默认权限 + 账号例外合并算法（super_admin 永久全部权限）
3. **DEV-015** 省份/地市/合同数据范围解析 + 统一服务端守卫（查询/写入/导出）
4. **DEV-016** 用户/角色/模块授权/账号例外权限管理 API（记录操作账号与时间）
5. **DEV-017** 一级门户 + 维护管理二级门户 API/前端路由（无权限状态）
6. **DEV-018** 工程管理/资产管理/人员管理建设中占位页（不读取经营数据）
7. **DEV-019** 四角色路由/API/导出自动化测试（AUTH-001~007、SEC-001~005）

**M2 前置**：基于 M1 的 `biz_` 模型，权限矩阵（02 文档 TABLE 2-7）固化为种子权限点；服务层切换新表。
