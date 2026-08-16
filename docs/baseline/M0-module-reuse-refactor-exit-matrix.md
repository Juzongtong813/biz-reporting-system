# M0 模块复用、改造与退出清单

> 任务：DEV-002
> 依据：开发任务与里程碑 v1.0 第 2 章、第 6.1 节；数据模型与技术架构方案 v1.0 第 2、3 章
> 权威主线：`E:\code2\biz-reporting-system-authoritative`
> 记录提交：`7bf78aa` 之后的 DEV-002 治理工作
> 状态：清单已建立；各项实现仍须通过对应任务测试后单独验收

## 1. 决策原则

1. 保留既有 NestJS、React、Ant Design、TypeORM、MySQL/SQLite 与 pnpm workspace，不建立第二套框架或账号体系。
2. 复用只针对经过边界审查的能力、算法和测试模式；禁止复制历史工作区的完整代码目录。
3. 新经营事实以 `biz_` 模型为权威。旧表、旧迁移和旧代码在完成数据核对及独立退役门禁前不物理删除。
4. “现有代码已存在”只代表可审查资产，不代表 DEV-002 或后续 DEV 任务已完成；完成状态必须由对应测试和报告确认。
5. 页面菜单隐藏不是安全边界。新入口、页面路由、API、数据范围必须分别受服务端授权保护。

## 2. 复用清单

| 现有资产 | 当前路径 | 决策 | 新业务使用方式 | 必须保留的边界 | 当前证据 |
|---|---|---|---|---|---|
| 工作区与应用栈 | `package.json`、`pnpm-workspace.yaml`、`apps/api`、`apps/admin-web`、`packages/*` | 复用 | 继续使用 NestJS 10、React 18、AntD 5、Vite、TypeORM、MySQL 8 | 不引入第二套框架、服务或账号体系 | 构建/typecheck 入口已登记于 DEV-001 |
| 认证基础设施 | `apps/api/src/auth`、`apps/api/src/common/guards` | 复用并扩展 | 复用 JWT、登录限流、停用失效、守卫模式；新基线由 `biz-auth` 增加模块/页面/动作/数据范围 | 新 API 必须服务端校验，不能只靠前端菜单 | `biz-auth`、`rbac` 路径与 M2 测试已存在，仍按对应任务复验 |
| 迁移与账本 | `scripts/db/migrate.mjs`、`scripts/db/migration-checksums.json` | 复用 | 继续使用追加式迁移、checksum、失败账本、二次幂等 | 禁止修改 001-015 历史迁移/checksum；结构变更只追加 | M8 正式 MySQL gate 与 ledger 证据 |
| Excel 安全读取 | `apps/api/src/common/files/workbook-policy.ts` | 复用安全层 | 订单域只复用大小、扩展名、工作表、行数等安全策略；业务解析按冻结 34 列重写 | 运行时代码不得绕过 `readWorkbookSafe`；不接受宏文件 | `workbook-policy.ts` 与 M4 订单测试 |
| 导出与浏览器通用工具 | `apps/admin-web/src/utils/page-export*`、`apps/api/src/ws6/exports.controller.ts` | 选择性复用 | 复用文件生成、分页、权限和下载任务模式；字段口径改为新 `biz_` 明细 | 不导出旧事实/旧报表包口径；敏感字段必须脱敏 | 现有导出测试；新导出范围待业务任务验收 |
| 操作审计模式 | `apps/api/src/operation-logs`、`apps/api/src/common/entities/operation-log.entity.ts` | 复用模式，使用新实体 | 复用操作类型、对象、账号、时间的记录模式；新基线使用最小 `biz_operation_logs` | 不保存字段修改前后值；审计主体兼容 UUID | M8 审计 API 与安全测试 |

## 3. 改造清单

| 现有模块/资产 | 当前路径 | 新模块 | 改造范围 | 禁止沿用 | 现状证据 |
|---|---|---|---|---|---|
| 旧合同域 | `apps/api/src/contracts`、`apps/admin-web/src/pages/Contracts` | 经营管理合同 | 使用 UUID、整数分、合同状态机、父合同、地市额度和费率历史；新入口使用 `biz-contracts` | 自增主键、decimal 金额、单值费率、旧软删除语义 | `apps/api/src/biz-contracts`、`apps/api/src/contracts` 并存 |
| 旧订单/导入域 | `apps/api/src/facts`、`apps/api/src/ws6` | 经营管理订单 | 复用安全读取和任务事务模式；重写 34 列严格校验、整批零写入、文件哈希幂等、负数/零入账、作废恢复 | 业务行去重、长期源文件、旧表头宽松匹配、city_user 上传 | `apps/api/src/biz-orders`、M4 测试与 `readWorkbookSafe` |
| 旧事实模型 | `apps/api/src/facts` | `biz_order_rows`、`biz_offline_completions`、`biz_cost_entries` | 新事实独立建模，汇总只读新事实；旧 facts 不作为新主模型 | 旧 fact/version/package 作为经营权威 | `apps/api/src/facts` 与 `apps/api/src/orders`/`completions`/`costs` 并存 |
| 旧成本域 | `apps/api/src/facts/cost-fact.entity.ts`、旧成本导入 | 经营管理地市成本 | 改为在线填报、分类必填、审核/作废状态机，成本行独立且不关联合同 | `contract_id` 成本关联、旧导入口径 | `apps/api/src/costs`、`apps/api/src/biz-costs` |
| 旧权限与用户 | `apps/api/src/users`、`apps/api/src/auth` | `biz-auth`、`rbac` | 保留认证基础设施；新用户/角色/模块/例外/数据范围使用 UUID 和四角色模型 | 旧 role 字符串直接决定全部业务权限、前端单独判断 | `apps/api/src/biz-auth`、`apps/api/src/rbac` |
| 旧城市字典 | `apps/api/src/cities`、`apps/api/src/city-configs` | `main-data` | 复用查询/维护模式；以省份、地市、别名 UUID 作为新关系主键 | 在业务代码中写死山东或用名称替代 UUID | `apps/api/src/main-data`、迁移 010/011 |
| 旧汇总/仪表盘 | `apps/api/src/dashboard`、旧 facts/package 查询 | `biz-aggregates` | 按订单+完工-作废、成本独立行、月度/累计和预警重算重写 | 旧报表包/月快照反向覆盖明细、浮点金额 | `apps/api/src/biz-aggregates`、M6 测试 |
| 旧消息/提醒 | `apps/api/src/reminders` | 新经营消息与合同预警 | 复用调度/通知模式；新实体以 `biz_` 预警和消息为准 | 旧指标口径直接触发新告警 | `apps/api/src/reminders`、`apps/api/src/aggregates` |

## 4. 退出清单

| 首发非范围资产 | 当前路径 | 退出动作 | 保留内容 | 退出门禁 |
|---|---|---|---|---|
| 旧报表包/版本工作台 | `apps/api/src/packages`、`apps/api/src/facts`、`apps/admin-web/src/pages/Packages`、`Versions` | 从新门户导航和新 API 消费链路退出；旧入口保留废弃提示或只读兼容 | 历史表、迁移、代码和受控读取能力 | DEV-065 退役证明、旧写入返回 410、回归测试 |
| AI 助手 | `apps/api/src/ai`、`apps/admin-web/src/pages/AiAssistant` | 不进入 `/#/biz` 新门户；保留只读隔离入口，禁止依赖经营主流程 | 只读代码和审计记录 | DEV-065 隔离证明与入口检查 |
| 微信邀请/小程序 | `apps/api/src/auth/wechat.service.ts`、`apps/api/src/users/wechat-invitation.entity.ts`、`apps/mini-program`、`apps/miniapp` | 不作为首发入口或账号体系；保留代码以便回退审查 | 历史代码、迁移和数据 | DEV-065 入口退出与依赖隔离 |
| 源文件下载/长期源文件 | `apps/api/src/facts/fact-source-file-storage.service.ts`、旧导入链路 | 新订单仅异步期间临时保存，任务结束清理；不提供旧源文件下载作为首发能力 | 审计元数据和必要错误报告 | M4 临时文件清理、存储门禁和回归 |

## 5. 前端入口映射

| 新入口 | 组件 | 数据边界 | 旧入口处理 |
|---|---|---|---|
| `/#/biz/portal` | `pages/biz/BizPortal.tsx` | 一级模块门户，只展示授权模块 | 根路径重定向到 `/biz/login` |
| `/#/biz/maintenance` | `pages/biz/BizMaintenancePortal.tsx` | 维护管理二级门户 | 不读取旧报表数据 |
| `/#/biz/operation` | `pages/biz/BizContracts.tsx` | 合同域 | 旧 `/admin/contracts` 保留兼容，不作为新入口 |
| `/#/biz/orders` | `pages/biz/BizOrders.tsx` | 订单批次、行和错误报告 | 旧导入路径不作为首发入口 |
| `/#/biz/offline-completions`、`/#/biz/costs` | 对应 biz 页面 | 完工与地市成本 | 旧事实/城市导入页面退出新导航 |
| `/#/biz/analysis`、`/#/biz/settings`、`/#/biz/admin` | 对应 biz 页面 | 汇总、设置、权限管理 | 无权限直达返回 403，不依赖菜单隐藏 |
| `/#/login` 及旧 `/*` | `LegacyBanner` + 旧页面 | 兼容/回退，不作为首发路径 | 显示废弃提示；不新增业务能力 |

## 6. 依赖与验收记录

### 6.1 当前结构核对

- 后端是模块化单体，旧模块与 `biz_` 模块并存；`apps/api/src/app.module.ts` 同时注册二者，符合“不原地破坏、逐步退出”原则。
- 前端新路由集中在 `apps/admin-web/src/App.tsx` 的 `/biz` 段，旧路由保留兼容并显示废弃标记。
- 新模型使用 `biz_` 前缀实体和追加迁移；旧迁移与旧表不作为新模型修改对象。

### 6.2 本任务的完成判定

DEV-002 交付物是本清单和评审边界，不把 M1-M8 历史实现自动标记为本任务已完成。后续每个“复用”项必须满足：

1. 通过对应领域测试，证明复用能力没有把旧业务规则带入新主流程；
2. 通过架构/权限/迁移门禁，证明新入口与旧入口、旧表和生产资源边界清晰；
3. 在对应里程碑报告中记录测试命令、结果、提交和未解决风险。

本清单不授权生产数据库、生产 CloudRun、对象存储或公网 API 操作。
