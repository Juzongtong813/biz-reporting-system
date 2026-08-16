# M0 DEV-003 改造前验证报告

> 任务：DEV-003
> 日期：2026-08-16
> 权威主线：`E:\code2\biz-reporting-system-authoritative`
> 验证起点：`a13fa3b`（DEV-002 文档格式提交后）
> 范围：共享包、API、前端构建与类型检查、架构门禁、SQLite 自动化、隔离 MySQL 自动化和浏览器回归
> 生产边界：未连接或写入生产数据库、CloudRun、对象存储、静态托管或公网 API

## 1. 结论

**DEV-003 已完成：改造前基线已实际执行并形成证据。**

构建、显式类型检查、架构检查、16 条迁移账本、四角色/业务域回归、浏览器回归和非 localhost MySQL 隔离验证均通过。现有自动化并非全部绿色：两套生产配置测试夹具在 DEV-064 弱密钥策略后未同步更新；已退役 facts-v31 旧域测试仍同时存在 HMAC 测试环境缺失和 better-sqlite3 原生崩溃。上述问题均已登记，**本任务不修改代码或测试**。

M0 可以继续执行 DEV-004 的脱敏夹具复验；但在测试夹具修复并重跑前，`release:preflight` 不应被宣告为当前提交的全绿证据。

## 2. 构建与类型检查

| 项目 | 等价执行方式 | 结果 | 备注 |
|---|---|---|---|
| shared-types 构建 | 本地 TypeScript CLI，`packages/shared-types/tsconfig.json` | 通过 | 生成共享声明 |
| shared-constants 构建 | 本地 TypeScript CLI，`packages/shared-constants/tsconfig.json` | 通过 | 依赖 shared-types 声明 |
| API 构建 | 本地 Nest CLI，`apps/api` | 通过 | NestJS 编译成功 |
| admin-web 构建 | 本地 TypeScript + Vite CLI，`apps/admin-web` | 通过 | Vite 仅报告既有大 chunk 警告，无构建失败 |
| 四包显式类型检查 | 各包自身 `tsc --noEmit` / `tsc -b --force` | 通过 | shared-types、shared-constants、API、admin-web 均通过 |
| 架构检查 | `node scripts/architecture/check-dependencies.mjs` | 通过 | 0 项违规 |

### 2.1 pnpm 运行环境说明

直接执行 `pnpm test:architecture` 时，Codex 受限运行时的 pnpm store 返回 `ERR_SQLITE_ERROR: unable to open database file`，项目脚本尚未启动。为避免把环境故障误判为项目故障，构建和检查均改用仓库已安装的本地 CLI 或相同 Node 脚本直接执行；对应项目结果见上表。此项需在可访问 pnpm store 的 CI/开发机再次确认，但不是代码编译失败。

## 3. 自动化结果

| 套件 | 结果 | 覆盖/证据 |
|---|---|---|
| `run-unit.mjs` | 通过 | 20 个测试文件：金额、认证、导入事务、导出、存储、Workbook 安全、运行就绪等 |
| `run-migration-ledger-contract.mjs` | 通过 | SQLite 空库迁移 001-015、checksum、种子与二次幂等 |
| `run-auth-v3.mjs` | 通过 | 登录限流、四角色、地市范围、停用/令牌失效等 |
| `run-metric-source-contract.mjs` | 通过 | 指标来源契约 |
| `run-page-exports.mjs` | 通过 | 4 sheet、7 页、数值格式与行数上限 |
| `check-fact-storage-gate.mjs` | 通过 | 源文件存储门禁 |
| `run-baseline-data-smoke.mjs` | 通过 | 20 实体、4 角色、16 地市、UUID/整数分/唯一约束闭环 |
| `run-m2-rbac-auth.mjs` | 通过 | 账号、权限、门户和数据范围 |
| `run-m3-contracts.mjs` | 通过 | 合同、额度、费率与状态机 |
| `run-m4-orders.mjs` | 通过 | 34 列、整批校验、幂等、负数/超额、作废恢复、性能回归 |
| `run-m5-offcost.mjs` | 通过 | 线下完工、成本、审核、作废和乐观锁 |
| `run-m6-aggregates.mjs` | 通过 | 汇总、重算、一致性核对、预警和设置 |
| `m7-views.mjs` | 通过 | 桌面/移动视口、登录/门户/业务页、无横向溢出、地市用户菜单隐藏与直达 403 |
| `run-m8-security.mjs` | 通过 | 生产弱密钥拒绝、管理员初始化/轮换/停用/审计闭环 |
| `run-migrations-mysql.mjs` | 通过 | 非 localhost 隔离 MySQL：001-015、二次幂等、失败账本、临时库清理 |
| `run-mysql-integration.mjs` | 通过 | 非 localhost 隔离 MySQL：M2、M3、M5、M6、M8 共 5/5 套件 |

浏览器回归第一次在受限环境因 Chromium `spawn EPERM` 未进入断言；经受控本地执行权限重跑后通过。该权限仅用于本机临时 SQLite 数据库和 localhost API/前端服务。

## 4. 发现与处置状态

| ID | 等级 | 现象与根因 | 当前影响 | 本次处置 |
|---|---|---|---|---|
| DEV003-01 | P1 测试门禁失配 | `check-production-runtime-config.mjs` 的“有效生产配置”将 JWT/HMAC 写为不足 32 字符的旧夹具；DEV-064 已正确拒绝弱密钥 | 该脚本失败，不能作为当前提交的绿色发布证据 | 待裁决后仅更新测试夹具为独立、强度合格的值，并重跑 |
| DEV003-02 | P1 测试门禁失配 | `run-deployment-preflight.mjs` 的有效 HMAC 夹具不足 32 字符；运行时正确返回弱密钥错误 | 部署预检脚本失败，`release:preflight` 当前不可宣告全绿 | 待裁决后仅更新测试夹具，并重跑 |
| DEV003-03 | 已退役域 / P2 | `run-facts-v31.mjs` 未注入 `AUTH_SECURITY_HMAC_KEY`，旧 `/auth/city/login` 返回 503；随后 Node 24 + better-sqlite3 触发 `UV_HANDLE_CLOSING` 原生断言 | 旧 facts-v31 不能通过；不覆盖 `/#/biz` 新主流程 | 维持 M8 旧域退役隔离豁免；若恢复旧事实运维，再独立修复测试环境和 Node/原生依赖兼容性 |
| DEV003-04 | P2 环境限制 | 当前 Codex 受限运行时 pnpm store 无法打开其 SQLite 索引 | 不能直接以 pnpm 运行命令；本地 CLI 等价验证已通过 | CI/常规开发机应以 `pnpm --frozen-lockfile` 重验，不改项目依赖或 lockfile |
| DEV003-05 | P3 构建告警 | admin-web Vite 报告一个现有压缩后约 986 KB chunk | 不阻断构建与功能；影响首屏性能风险待量化 | M7/M8 性能任务中结合真实指标决定是否拆包 |

## 5. 可追溯性与下一步

- 任务书第 16 章要求的关键类别已执行：金额/权限/状态机、34 列订单、隔离 MySQL、浏览器关键流程均有现行自动化证据。
- 自动化不包含真实敏感文件；本次没有读取或提交真实 Excel。
- 旧 facts-v31 的失败不被静默忽略：它保留为退役域风险项，并与新 `biz_` 主流程回归明确隔离。
- 下一项为 DEV-004：复验并补齐脱敏金标准、四角色、模板错误、负数与超额夹具；真实 Excel 仅登记哈希，不提交原件。

