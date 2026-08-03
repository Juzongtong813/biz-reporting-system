# 实施任务与验收状态

状态：`PASS`、`FAIL`、`BLOCKED`、`NOT_STARTED`。

## P0

- [PASS] P0-1 恢复 001 Git 基线；新增 8 文件 checksum 清单与扫描。`002_contract_city_business_metrics.sql` 已跟踪且无差异；`002_add_contract_month_invoice_order_amount.sql` 与 003–006 当前未跟踪，不能宣称由 Git 证明不变。
- [PASS] P0-2 MySQL 验收脚本按 8 行账本和 007 结构校验；空库 002 明确断言为 `executed`，并由独立账本回归验证二次执行不变。
- [PASS] P0-3 两个公开注册地址在真实 Nest 隔离测试中返回 404，用户数不变；运行时代码和面向使用者的旧流程说明已清理。
- [PASS] P0-4 AppModule 全局注册 `RolesGuard`；旧 packages/imports/reminders/AI/city 端点完成正反权限自动化。
- [PASS] P0-5 四角色登录通道、临时密码、本人改密、旧密码/JWT 失效和设置入口自动化通过。

## P1

- [PASS] P1-1 Dashboard 顶部 KPI、业务汇总、Admin Facts 与 CityEstimate 已复用 `FactsService`：订单/实际成本来自事实表，完工/审定/开票通过统一只读兼容适配读取月度进度；旧预算/综合代维只读兼容及退出条件已冻结。旧写流程的最终下线仍按退出计划执行，不再作为分析数据源。
- [BLOCKED] P1-2 缺少四项 `MIGRATION_TEST_MYSQL_*`，真实 MySQL 未执行；脚本按要求硬失败。
- [BLOCKED] P1-3 无非生产持久卷/COS 环境；仅启动路径门禁通过，重启、重建、备份恢复未执行。
- [BLOCKED] P1-4 当前无可用浏览器会话且无隔离 MySQL 验收后端；四角色与逐页 XLSX 真实验收未执行。

## P2

- [PASS] P2-1 Admin Facts 支持全省、单地市及多 `cityIds` 的汇总、成本、订单和进度查询；事实总览筛选、表格、汇总与 XLSX 导出复用同一查询条件，CityEstimate 同步使用多地市事实接口。
- [PASS] P2-2 已清理 `packages/shared-types/src` 中 64 个编译产物，架构检查 0 违规；`source_file_base64` 仍被旧导入链路使用，评估为待新增迁移替换，不原地删列。
- [PASS] P2-3 `overview.md` 已改为当前入口，小程序代码讲解明确归档边界，地市端使用手册已移除草稿/提交/锁定旧流程；历史 baseline/spec 保持历史属性，不冒充当前说明。

## 最终门禁

- [PASS] CODE
- [PASS] AUTOMATED_TESTS
- [BLOCKED] REAL_MYSQL
- [BLOCKED] BROWSER
- [BLOCKED] EXPORT_FILES（真实浏览器下载对照）
- [BLOCKED] PERSISTENT_STORAGE
- [PASS] FACT_MODEL_UNIFICATION（旧报表包只读兼容，退出计划已冻结）
- [BLOCKED] DEPLOYMENT_GATE

最终状态：`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`。

## 完整性收口新增任务

- [x] I-1 修正 `run-migrations-mysql.mjs` 空库 002 执行模式断言；`pnpm test:migrations:ledger` 已验证 8 行账本、002=`executed`、二次幂等和自动清理。
- [x] I-2 已建立 `release-manifest.json`、机器报告和发布 gate；必需文件数量、Git 跟踪状态与文件集合 digest 由 `node scripts/release/check-release-integrity.mjs` 实时生成。当前仍存在未跟踪必需文件，因此发布追溯门禁保持 BLOCKED，未擅自暂存或提交。
- [x] I-3 已统一 Dashboard 顶部 KPI、业务汇总、CityEstimate 与完工/审定/开票来源；`V3_METRIC_SOURCE_MANIFEST` 明确分析侧只读兼容、禁止混用字段和三步退出计划，契约测试通过。
- [x] I-4 已完成 Admin Facts 全省/单地市/多地市查询、筛选及 XLSX 导出；隔离事实集成测试新增多地市正向范围断言。
- [x] I-5 已清理 overview、小程序说明、地市端使用手册、任务和验收报告中的陈旧或过度完成表述；历史基线保留原始记录并与当前权威资料分离。
- [x] I-6 已对照总纲和两套全局 specs 更新阶段证据；新增 `release:completeness`，分别判定本地完整性、Git 追溯、真实 MySQL、浏览器和持久存储，外部证据缺失时必须退出 2。
- [BLOCKED] I-7 本地 I-1–I-6 已完成，但发布 Git 追溯尚未闭合，且缺少隔离 MySQL 凭据、真实浏览器验收后端与非生产持久卷/COS；按顺序约束未执行外部门禁。
