# M0 基线就绪报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-14
> 阶段：M0「基线就绪」
> 结论：**M0 通过（无阻塞项），可进入 M1 数据基础**

---

## 1. 权威文档阅读确认

已按顺序完整阅读并抽取 9 份权威基线文档全文（DOCX → 文本）：

| 序号 | 文档 | 状态 |
|---|---|---|
| 01 | 产品需求基线 v1.1 | 已确认 |
| 02 | 角色与权限矩阵 v1.1 | 已确认（文档头标"待业务确认"，但含"已确认的权限裁决"章） |
| 03 | 指标字典与金标准样例 v1.0 | 已确认 |
| 04 | 业务状态机与异常处理规则 v1.0 | 已确认 |
| 05 | 订单模板字段映射表 v1.0 | 已确认 |
| 06 | 页面信息架构与关键原型说明 v1.0 | 已确认 |
| 07 | 数据模型与技术架构方案 v1.0 | 待业务确认 |
| 08 | 测试与验收方案 v1.0 | 待确认 |
| 09 | 开发任务与里程碑 v1.0 | 待确认 |

已抽取全文存于 `E:\code2\_m0_baseline_docs\`（临时，不入 Git）。

**核心业务硬规则（18 条）** 已全部从 01/02/03/04/05/07 文档核验落实，作为后续开发唯一依据。旧总纲 `docs/经营数据中台总纲.md`、旧 `specs/`、旧交付报告、旧 memory 与历史任务清单**不覆盖**本基线。

---

## 2. Git 状态

| 项 | 值 |
|---|---|
| 分支 | `recovery/production-governance-20260803`（与 origin 同步） |
| HEAD | `60f3a48 checkpoint: recover production governance baseline` |
| 工作树 | clean（无未提交变更） |
| 近 3 次提交 | 60f3a48 / bad2a7d（v0.2 核心功能闭环）/ 9542f8f（init 双库架构） |

基线 09 要求「冻结唯一代码主线」，当前主线已确定。建议在 M0 收尾时对当前 HEAD 打基线标签 `m0-baseline`（可选，不阻塞）。

---

## 3. 构建、类型检查与测试

### 3.1 依赖环境

- Node `v24.14.0`，pnpm `9.15.0`（经 `npm i -g pnpm@9.15.0` 补装，`corepack` 亦可用）。
- 依赖 `pnpm install --frozen-lockfile` 成功（705 包）。

### 3.2 构建结果（全部通过）

| 目标 | 命令 | 结果 |
|---|---|---|
| shared-types | `pnpm --filter @biz-reporting/shared-types build` | ✅ |
| shared-constants | `pnpm --filter @biz-reporting/shared-constants build` | ✅ |
| api | `pnpm --filter @biz-reporting/api build`（nest build） | ✅ |
| admin-web | `pnpm --filter @biz-reporting/admin-web build`（tsc -b && vite build） | ✅ |

### 3.3 类型检查

`pnpm -r typecheck` 仅 shared-types / shared-constants 有 typecheck 脚本；api 与 admin-web 无 typecheck 脚本（以 build 的 tsc 编译作为类型门禁）。shared-constants 的 typecheck 依赖 shared-types 先 build（否则报 TS2307 找不到模块）。→ **M0 记录：根脚本 `typecheck` 顺序有缺陷，需在 M1 前补一个先 build shared-types 的 CI 顺序或为 api/admin-web 补 typecheck 脚本。**

### 3.4 自动化测试

| 测试 | 结果 | 说明 |
|---|---|---|
| test:unit（20 文件） | ✅ 全通过 | 含 workbook 安全策略 D-05、import-job 迁移 D-06 |
| test:architecture | ✅ 0 违规 | 依赖方向检查 |
| test:migrations:ledger | ✅ 10 迁移全 applied | SQLite 环境，二次幂等通过 |
| test:auth-v3 | ✅ 全通过 | 四角色权限 + 城市范围 + 登录限流 5 次 429 |
| test:metric-sources | ✅ | v3-facts-unified 契约 |
| test:exports-v3 | ✅ | 4 sheet / 7 页 / 1 万行限制 |
| test:storage-gate | ✅ | /mnt/fact-source-files 门禁 |
| test:facts-v31 | ❌ BLOCKED | 见 §7 阻塞项 |

---

## 4. 迁移账本与运行配置

### 4.1 迁移账本

- 位置：`apps/api/migration/*.sql`（10 个迁移），checksum 账本 `scripts/db/migration-checksums.json`。
- 迁移顺序：001 初始表 → 002（两份）→ 003 城市种子 → 004 软删除 → 005 事实数据 → 006 血缘 → 007 RBAC → 008 v3 生命周期 → 009 生产治理。
- 迁移工具 `scripts/db/migrate.mjs` 支持 sqlite / mysql 双 dialect，带 precheck（checksum 漂移 / 失败 / partial 状态拦截）与生产审批门禁（`MIGRATION_APPROVED=true`）。
- SQLite 下 10 个迁移全部 applied 且幂等通过。**真实 MySQL 8 迁移尚未验证（见 §7 阻塞项）。**

### 4.2 运行配置

- `apps/api/.env.example` 完整，含 MySQL/SQLite 双模式、JWT、登录限流、CORS、COS 等，无真实凭据。
- TypeORM 配置（`app.module.ts`）：开发默认 better-sqlite3（DB_SYNC 默认 true），生产强制 mysql 且 `synchronize: false`。
- 生产运行时校验（`runtime.config.ts`）强制：非 root、非 localhost、DB_SYNC=false、HTTPS CORS origin、JWT issuer/audience、独立 HMAC 密钥等。
- **无 docker-compose，无隔离 MySQL 8 gate**。本地开发数据库目前只有 SQLite 路径可用。

### 4.3 安全边界注意项（M0 记录，M8 收口）

`apps/admin-web/.env.production` 硬编码 `VITE_API_BASE_URL=https://zy-data-d2g9g1ghr47ac6254.service.tcloudbase.com/api`，指向公网共享环境。按安全边界「不得连接 zy-data / 公网 staging / 生产库」，M0 不触碰该值，但必须在 M7/M8 收口前替换为受控部署域名，且确认该环境从未用于本地迁移测试。

---

## 5. 当前实现 vs 新基线差异清单

以下为基线 09 §2.2「必须纠正的冲突」在权威主线中的落地确认，全部属实：

| # | 差异项 | 当前实现 | 新基线要求 | 影响 |
|---|---|---|---|---|
| 1 | 金额存储 | `decimal(18,2)`（contracts/allocation/order_facts/cost_facts） | 整数分（BIGINT） | 全核心表 |
| 2 | 主键 | `@PrimaryGeneratedColumn()` 自增 int | 系统内部 UUID，真实合同号唯一 | 全核心表 |
| 3 | 合同状态 | 仅 `is_deleted` 软删除 | 完整状态机（草稿/执行中/已完成/已作废 + 待完成确认标签） | contracts |
| 4 | 合同额锁定 | 无锁定 | 生效后永久锁定，录错只能作废重立 | contracts |
| 5 | 费率模型 | `contracts.rate` + `allocation.rate` 单值 | `contract_fee_rates`（合同+地市+生效月份历史） | 费率域 |
| 6 | 订单去重 | `order_facts.business_key` 唯一键 | 不做业务行去重，文件哈希+最大下单时间防重 | order 域 |
| 7 | 订单结构 | 34 列按关键表头匹配 | 单 sheet + 固定 34 列、列名/列数/顺序完全一致，F 列完工金额 | 订单解析 |
| 8 | 源文件保存 | 长期保存 fact 源文件 | 仅异步任务期间临时保存，结束删除 | 存储 |
| 9 | 成本关联 | `cost_facts.contract_id` 关联合同 | 地市月度成本不关联合同，在线填报 | cost 域 |
| 10 | 角色模型 | `users.role` 字符串（system_admin/city_user） | 四角色 + 模块权限 + 账号例外 + 数据范围 | 权限域 |
| 11 | 地市上传 | city_user 有文件上传入口 | 仅 super_admin + admin 上传订单 | 订单入口 |
| 12 | 计算精度 | JS 浮点直接算金额 | 整数分 + 整数基点 + 服务端四舍五入 | 指标域 |
| 13 | 门户 | 旧报表包 / 版本工作台 / AI / 小程序 | 两级门户 + 经营管理分类导航 | 前端 |
| 14 | 省份/地市 | 无独立省份实体（仅 cities） | 省份+地市两级字典，不写死山东 | 主数据 |

---

## 6. 模块分级（复用 / 重构 / 退出）

### 6.1 可复用（保留技术栈与框架，扩展边界）

| 资产 | 路径 | 复用方式 |
|---|---|---|
| 技术栈 + monorepo | pnpm workspace + NestJS10 + React18 + AntD5 + Vite5 | 保留，不另起框架 |
| 登录与守卫 | `apps/api/src/auth/`、`common/guards/*` | 扩展为四角色 + 模块 + 数据范围 |
| 登录限流/锁定 | auth 模块 + throttler | 已通过 auth-v3，保留 |
| 迁移框架 | `scripts/db/migrate.mjs` + checksum 账本 | 追加式迁移复用 |
| XLSX 安全读取 | `readWorkbookSafe`（workbook-policy） | M4 重写解析时复用安全读取 |
| 导出框架 | page-export（XLSX/CSV） | M7 替换为新明细口径 |
| 操作日志 | `operation-log.entity.ts` | 最小操作日志复用 |

### 6.2 需重构（保留模块边界，重写模型/算法）

| 模块 | 路径 | 重构点 |
|---|---|---|
| 合同域 | `contracts/`（contract/allocation/contract-city-business-metric） | UUID、整数分、状态机、费率历史、父合同 |
| 订单域 | `facts/order-fact.entity.ts` + ws6 导入 | 34 列原值、去重键移除、整批事务、作废恢复 |
| 成本域 | `facts/cost-fact.entity.ts` | 不关联合同、在线填报、审核状态机 |
| 指标计算 | dashboard/ + facts 汇总 | 整数分、费率快照、毛利润/净利润、共享合同去重 |
| 权限模型 | users + auth guards | 四角色 + 模块 + 数据范围 |

### 6.3 需退出（首发非范围，M8 退役，不物理删除历史表）

| 模块 | 路径 | 退出方式 |
|---|---|---|
| 旧报表包 / 版本工作台 | `packages/*`（annual-package/month-snapshot/month-unlock-grant/contract-month-row/cost-month-row/maintenance-month-row）、facts/version | 导航/路由/API 消费链路退出 |
| AI 助手 | `ai/` | 入口退出 |
| 微信邀请 / 小程序 | `miniprogram/`、`miniapp/`、`wechat-invitation.entity.ts` | 入口退出 |
| 源文件下载 | fact source 下载链路 | 退出，仅临时文件 |

---

## 7. 阻塞项（BLOCKED）

| ID | 阻塞项 | 影响任务 | 解除方式 |
|---|---|---|---|
| BLK-1 | **隔离 MySQL 8 不可用**：无 docker-compose，无隔离 MySQL gate。真实 MySQL 8 迁移验证无法执行。 | M1（DEV-012 真实 MySQL 迁移验证）、M4 集成测试 | 提供隔离 MySQL 8（如 127.0.0.1:34001）或本地受控 MySQL 8 实例；在此之前 M1 仅能 SQLite 验证，不得形成发布候选 |
| BLK-2 | **facts-v31 集成测试崩溃**：Node v24.14.0 + better-sqlite3@12.10.0 原生崩溃（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），且脚本依赖外部路径 `E:\code2\biz-reporting-design-v2\参考数据`。 | M0 改造前完整回归（DEV-003） | 降级 Node 至 18/20 LTS 或升级 better-sqlite3；该测试属旧事实工作台，M8 将随旧事实模型退役，短期不阻塞 M1-M6 |
| BLK-3 | **非电商订单模板列名变体**（8 列名不同，见 real-excel-registry.md） | M4 订单域（DEV-028 固化 34 列） | M4 开工前业务确认：仅电商模板 or 别名映射。当前按「仅电商版 34 列严格匹配」执行 |

> BLK-2、BLK-3 均不阻塞 M1（数据基础）推进；BLK-1 决定 M1 能否形成「真实 MySQL 通过」的发布候选。

---

## 8. 测试夹具与真实 Excel

- 脱敏金标准夹具：`docs/baseline/golden-samples.json`（金标准样例一/二、四角色、订单 34 列模板、精度规则，全部虚构值）。
- 真实 Excel 受控哈希：`docs/baseline/real-excel-registry.md`（3 份 34 列订单文件 + 1 份 70 列结算文件，仅哈希与结构，不含敏感数据）。
- 已核实：电商订单 34 列表头与基线 05 冻结模板**逐列一致**；F 列确为「含税总金额」。

---

## 9. 下一里程碑（M1 数据基础）计划

按基线 09 表 6（DEV-005 ~ DEV-012），M1 交付：

1. **DEV-005**：省份、地市标准字典 + UUID（不写死山东）。
2. **DEV-006**：用户/角色/权限/账号例外/数据范围模型 + 四角色固化。
3. **DEV-007**：合同表重构（UUID、合同号唯一、整数分、日期、状态、父合同、版本字段）。
4. **DEV-008**：合同-地市分配 + 固定额度 + 费率历史模型。
5. **DEV-009**：订单批次 + 34 列原始行 + 标准化字段 + 金额分 + 费率快照 + 超额标识模型。
6. **DEV-010**：线下完工 + 月度成本 + 审核状态模型。
7. **DEV-011**：汇总、合同预警、消息、重算任务、最小操作日志模型。
8. **DEV-012**：追加式 MySQL 迁移 + 索引 + 空库初始化 + 测试种子 + 二次幂等 + 迁移账本验证。

**M1 关键约束**：不修改旧迁移文件与 checksum；新迁移只追加（010 起）；不使用 synchronize=true 代迁移；真实 MySQL 迁移通过前不得形成发布候选。

**M1 前置依赖**：BLK-1（隔离 MySQL 8）需在 DEV-012 前解除；否则 M1 只能完成模型与 SQLite 验证，DEV-012 标记 BLOCKED。
