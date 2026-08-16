# 发布预检报告（DEV-068）

> 日期：2026-08-16 · 脚本：scripts/release/preflight.mjs
> 结论：**预检通过（BLK-1 已解除，满足 M8 最终验收前置）**

## 检查结果

| 项目 | 状态 | 说明 |
|---|---|---|
| 迁移 checksum | ✅ | 16 个迁移文件 checksum 全部一致 |
| 迁移账本 | ✅ | MIGRATION_LEDGER_CONTRACT_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-migration-ledger-jjbQiL |
| 生产密钥审计 | ✅ | 未发现弱密钥 |
| test:unit | ✅ | UNIT_SUITE_OK files=20 |
| test:architecture | ✅ | 架构检查通过：0 项违规 |
| test:migrations:ledger | ✅ | MIGRATION_LEDGER_CONTRACT_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-migration-ledger-KET1Uq |
| test:m2-rbac-auth | ✅ | M2_RBAC_AUTH_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m2-rbac-QsSyC9 |
| test:m3-contracts | ✅ | M3_CONTRACTS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m3-contract-8JxFOy |
| test:m5-offcost | ✅ | M5_OFFCOST_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-m5-offcost-F1Uro4 |
| test:m6-aggregates | ✅ | M6_AGG_CLEANUP_OK |
| test:m7-views | ✅ | M7_VIEWS_CLEANUP_OK |
| test:auth-v3 | ✅ | RBAC_AUTH_SETTINGS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-rbac-auth-92pI3W |
| test:exports-v3 | ✅ | PAGE_EXPORTS_CLEANUP_OK root=C:\Users\lhx\AppData\Local\Temp\biz-page-export-kIvijR |
| test:metric-sources | ✅ | METRIC_SOURCE_CONTRACT_OK version=v3-facts-unified-2026-07-29 legacy=read_only_compatibility |
| test:storage-gate | ✅ | FACT_SOURCE_STORAGE_GATE_OK root=/mnt/fact-source-files |

## BLK 清单

| ID | 状态 | 说明 |
|---|---|---|
| BLK-1 | resolved | 正式 MySQL gate 已通过（192.168.1.197:34001，MySQL 8.0.46）：迁移 001-015 共 16 条，M2/M3/M5/M6/M8 集成 5/5 全过 |
| BLK-2 | mitigated-by-retirement | facts-v31 测试 Node24 崩溃：旧事实工作台已退役隔离（见 M8-legacy-retirement.md），新系统无依赖，风险豁免已记录 |
| BLK-3 | accepted-out-of-scope | 非电商订单模板 8 列名变体：M4 范围外事项，已确认仅支持电商版 34 列 |

## 结论

预检通过（核心检查全绿）。BLK-1 已解除（正式 MySQL gate 通过）；满足 M8 最终验收前置条件，可进入发布候选评审。
