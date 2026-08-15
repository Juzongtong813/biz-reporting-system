# 发布预检报告（DEV-068）

> 日期：2026-08-15 · 脚本：scripts/release/preflight.mjs
> 结论：**预检通过（待 BLK-1 解除后最终验证）**

## 检查结果

| 项目 | 状态 | 说明 |
|---|---|---|
| 迁移 checksum | ✅ | 15 个迁移文件 checksum 全部一致 |
| 迁移账本 | ✅ | MIGRATION_LEDGER_CONTRACT_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-migration-ledger-EuN8Qj |
| 生产密钥审计 | ✅ | 未发现弱密钥 |
| test:unit | ✅ | UNIT_SUITE_OK files=20 |
| test:architecture | ✅ | 架构检查通过：0 项违规 |
| test:migrations:ledger | ✅ | MIGRATION_LEDGER_CONTRACT_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-migration-ledger-XSLTEq |
| test:m2-rbac-auth | ✅ | M2_RBAC_AUTH_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m2-rbac-DaDq4d |
| test:m3-contracts | ✅ | M3_CONTRACTS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m3-contract-dfvsws |
| test:m5-offcost | ✅ | M5_OFFCOST_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m5-offcost-f51xsP |
| test:m6-aggregates | ✅ | M6_AGG_CLEANUP_OK |
| test:m7-views | ✅ | M7_VIEWS_CLEANUP_OK |
| test:auth-v3 | ✅ | RBAC_AUTH_SETTINGS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-rbac-auth-vbiZVU |
| test:exports-v3 | ✅ | PAGE_EXPORTS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-page-export-2DuEzC |
| test:metric-sources | ✅ | METRIC_SOURCE_CONTRACT_OK version=v3-facts-unified-2026-07-29 legacy=read_only_compatibility |
| test:storage-gate | ✅ | FACT_SOURCE_STORAGE_GATE_OK root=/mnt/fact-source-files |

## BLK 清单

| ID | 状态 | 说明 |
|---|---|---|
| BLK-1 | open | 隔离 MySQL 8 未提供；真实 MySQL 完整验证（M1-M8 迁移+集成）通过前不得宣布发布候选 |
| BLK-2 | mitigated-by-retirement | facts-v31 测试 Node24 崩溃：旧事实工作台已退役隔离（见 M8-legacy-retirement.md），新系统无依赖，风险豁免已记录 |
| BLK-3 | accepted-out-of-scope | 非电商订单模板 8 列名变体：M4 范围外事项，已确认仅支持电商版 34 列 |

## 结论

预检通过（核心检查全绿）。注意：BLK-1 未解除前仅代表预检通过，不构成发布候选；真实 MySQL 完整验证通过后方可宣布 M8 完成。
# 当前状态更正（2026-08-15）

该文件原报告基于 15 条迁移，已被当前工作区的追加迁移 015 supersede。当前本地 MySQL 隔离验证为 `local-isolated/non-gate PASS`，正式 `release:preflight` 尚未重跑：pnpm 试图在无交互环境清理生成的 `node_modules`，执行未获授权。因此不得将下方旧版 PREFLIGHT_PASS 作为当前发布候选证据。

## DEV-067 正式 gate 结果（2026-08-16）

正式非 localhost MySQL `192.168.1.197:34001`（8.0.46）已通过 `node scripts/test/run-migrations-mysql.mjs`，并通过 `node scripts/test/run-mysql-integration.mjs` 的五套集成测试，输出 `MYSQL_INTEGRATION_GATE_PASS 5/5`。因此 BLK-1 的实例不可用阻塞已解除。

本次尝试执行 `pnpm release:preflight` 时，pnpm 在项目测试启动前因运行时缓存 SQLite `unable to open database file` 失败并触发自动 install；该环境问题导致当前预检证据仍为 BLOCKED，不能形成发布候选。待具备可写 pnpm store/依赖环境后，必须重新执行并留存新的 `PREFLIGHT_PASS`。
