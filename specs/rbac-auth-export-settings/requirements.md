# RBAC、认证、导出与经营口径收口需求

> 当前状态：`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`。本规格覆盖代码安全、迁移不可变性、页面导出、用户设置、事实口径及真实环境门禁；不授权访问任何生产或共享环境。

## R1 环境边界

- 禁止连接或修改 `zy-data`、公网 `biz-reporting-api`、默认 schema、共享开发库、生产数据库、生产 COS、生产持久卷及现有公网服务。
- 所有可执行验证必须使用显式创建且可自动清理的隔离资源。
- 缺少隔离 MySQL 凭据、浏览器会话或持久存储环境时，对应门禁必须为 `BLOCKED`，不得以 SQLite、静态断言或本地临时目录替代。

## R2 迁移不可变性

- `001_initial_tables.sql` 必须与 Git 基线一致；`invoice_amount`、`order_amount` 只能由 `002_add_contract_month_invoice_order_amount.sql` 创建。
- 已执行或可能已执行的迁移不得原地修改；新结构只能追加新迁移。
- `scripts/db/migration-checksums.json` 固定当前 8 个迁移文件的 SHA-256；`check-files` 必须拒绝遗漏、额外文件和 checksum 漂移。
- 当前 Git 基线仅跟踪 `001`；`002`–`007` 在当前工作区为未跟踪文件。文档不得把未跟踪文件描述为“经 Git 证明未修改”。
- 真实 MySQL 验收必须使用全部四项 `MIGRATION_TEST_MYSQL_*`，拒绝 localhost、root、默认配置及生产模式。

## R3 角色与授权

- 固定角色：`root_admin`、`contract_manager`、`system_admin`、`city_user`。
- `root_admin` 唯一且不可删除、禁用、降级或绑定地市。
- `contract_manager` 仅维护合同、合同分配和生效费率，可读取地市目录。
- `system_admin` 保留省级运营能力，合同只读且不得管理账号。
- `city_user` 只能访问认证记录绑定地市的数据和已分配合同。
- Shared Types 冻结角色、权限和映射；全局 `JwtAuthGuard`、`PermissionsGuard`、`RolesGuard` 依次提供默认认证、新权限能力控制和旧 `@Roles` 端点兼容保护。
- `Scope` 必须以数据库用户的角色和 `cityId` 为准，前端菜单与请求参数均不是安全边界。

## R4 认证与账号安全

- `POST /api/auth/city/register`、`POST /api/auth/wechat/register` 必须不存在并返回 404，不能创建账号或返回 JWT。
- 管理员登录仅允许 `root_admin`、`contract_manager`、`system_admin`；地市密码及微信登录仅允许 `city_user`。
- JWT 包含 `sub`、`role`、`cityId`、`authVersion`；每次认证重新读取数据库状态与范围。
- 只有 `root_admin` 可创建普通账号、签发微信邀请、重置密码、启停账号、修改角色和地市。
- 临时密码仅一次返回；临时密码用户只能访问 `me.read`、`me.password.update`、`auth.logout`。
- 密码、邀请、角色、范围或状态变化必须递增 `authVersion`，立即撤销旧 JWT。
- 微信绑定必须基于预建 `city_user` 和短期一次性邀请，服务端只保存邀请散列。
- 密码、JWT、邀请明文、openid 明文及散列不得进入响应持久化、日志或审计。

## R5 用户设置

- `/admin/settings` 显示非敏感本人信息并提供原密码、新密码、确认密码表单。
- 新密码为 8–128 位、不得与原密码相同；已有密码必须验证原密码。
- 服务端只修改当前 JWT 对应用户，不接受目标 `userId`、`role` 或 `cityId`。
- 成功后递增 `authVersion`、清除前端令牌并返回登录页；旧密码和旧 JWT 立即失效。

## R6 页面导出

- Dashboard、CityEstimate、本地市总览、数据、合同、成本、订单均提供 `DownloadOutlined`“导出本页”。
- 页面展示与导出复用同一筛选结果；分页页导出全部筛选结果，不限当前页。
- XLSX 文件名包含页面、范围、期间和时间；金额、比例、日期保持正确数据类型和格式。
- 单次上限 10000 行，超限明确拒绝；导出写入不含敏感信息的操作审计。
- 地市导出范围始终由 JWT/数据库约束，不能通过参数扩展。

## R7 事实模型口径

- `V3_METRIC_SOURCE_MANIFEST` 是 Dashboard 与 CityEstimate 的显式口径声明。
- Dashboard 顶部 KPI、业务汇总、Admin Facts 与 CityEstimate 必须调用同一 `FactsService` 聚合入口。
- 完工、审定、开票暂由 `report_contract_monthly_rows` 只读兼容提供；分析链路不再从 `month_snapshots` 选择另一套值。
- 订单实际来自 `order_facts`；实际成本来自 `cost_facts`；毛利润使用审定金额乘合同分配生效费率；实际净利润为毛利润减实际成本。
- CityEstimate 的成本预算和综合代维仍来自旧报表包只读兼容，必须在界面和导出中与实际成本区分。
- 禁止同一指标在无声明时混用旧包与事实表。退出条件是补齐月度进度/预算事实表、迁移存量数据、切换前端入口，并完成真实 MySQL 与浏览器验收。

## R8 Admin 多地市

- Dashboard 支持全省、单地市和多地市筛选，卡片、表格、图表和导出复用同一结果。
- CityEstimate 支持选择 1–5 个地市，组合所选地市当前年度数据并记录完整导出范围。
- Admin Facts 后端支持全省、单个 `cityId` 和多个 `cityIds`；汇总、进度、成本、订单、筛选和导出必须继承同一范围。
- `city_user` 不得获得多地市能力。

## R9 验收门禁

- 自动化覆盖四角色正反权限、旧端点、跨地市、临时密码、邀请、根账号保护、JWT 失效、导出契约与口径声明。
- 真实 MySQL 必须验证 8 行账本、001–007、007 结构、第二根拒绝、二次执行不变、失败账本和清理。
- 真实浏览器必须完成四角色、改密、旧 JWT、跨地市、逐页 XLSX 对照。
- 持久存储必须完成上传、重启、重建实例、下载、联合备份恢复和 checksum 对照。
- 任一真实门禁未关闭，最终状态保持 `RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`。
