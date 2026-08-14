# M4 订单域里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M4「订单域」
> 结论：**M4 完成（SQLite 全验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-028 | 34 列模板常量固化（shared-types order-template）+ 迁移 013（批次 temp_file_path 列） | ✅ |
| DEV-029 | 上传入口：仅 super_admin/admin、.xlsx、单工作表、50MB、20 万行（数据行） | ✅ |
| DEV-030 | 临时文件受控存储（任务结束删除，不提供下载）+ 异步解析任务 | ✅ |
| DEV-031 | 解析器重写：列名/列数/顺序严格匹配；34 列原值 + 标准化（省/市/合同/时间/金额分/费率快照/毛利润） | ✅ |
| DEV-032 | 整批校验：省份/地市/合同/分配/时间/费率任一错误 → FAILED 零写入 + 错误报告 | ✅ |
| DEV-033 | 请求幂等（idempotency_key 唯一返回原批次）+ 文件哈希+最大下单时间防重（DB 唯一） | ✅ |
| DEV-034 | 无业务去重；正/零/负金额全部入账；两级超额不阻断导入 | ✅ |
| DEV-035 | 批次作废/恢复仅 super_admin（原始行保留、操作账号/时间、重算生效） | ✅ |
| DEV-036 | 订单页面：上传/批次列表/详情/错误报告/订单行（超额筛选 + 敏感列脱敏） | ✅ |
| DEV-037 | ORD-001~016 测试 + 真实订单文件受控验证 + 20 万行性能（82s < 120s 阈值） | ✅ |

## 2. 修改文件

### 新增（9）
- `apps/api/src/biz-orders/biz-order-import.service.ts`（解析/校验/入账/作废恢复）
- `apps/api/src/biz-orders/biz-orders.controller.ts`、`biz-orders.module.ts`
- `apps/api/migration/013_biz_order_temp_file.sql`
- `apps/admin-web/src/pages/biz/BizOrders.tsx`（上传/批次/行页面）
- `scripts/test/run-m4-orders.mjs`（ORD-001~016 集成测试）
- `apps/admin-web/src/api/biz.api.ts`（订单 API 客户端函数）

### 修改（7）
- `apps/api/src/app.module.ts`（注册 BizOrdersModule）
- `apps/api/src/orders/biz-order-import-batch.entity.ts`（tempFilePath 字段）
- `apps/api/src/common/files/workbook-policy.ts`（readWorkbookSafe 支持 maxRowsPerSheet 参数，统一安全读取）
- `apps/admin-web/src/App.tsx`（/biz/orders 路由 + 合同/订单互链）
- `scripts/db/migrate.mjs`（inspectState 013）+ `migration-checksums.json`（追加 013）
- `scripts/test/run-migration-ledger-contract.mjs` / `run-migrations-mysql.mjs`（14 迁移）
- `package.json`（test:m4-orders）

## 3. 数据库迁移

| 迁移 | 内容 | 状态 |
|---|---|---|
| 013_biz_order_temp_file | `biz_order_import_batches` 加 `temp_file_path`（异步任务残留回收） | ✅ SQLite applied |

checksum 已追加（013: `0583020c…`），001-012 未动。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit(20) / architecture / ledger(14) / baseline-smoke / m2 / m3 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m4-orders`**（新增） | ✅ ORD-001~016 全过 |
| `pnpm migration-files:check` | ✅ 14 迁移 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

**ORD-001~016 断言**：
- ORD-001 city_user 上传 403 / admin 上传 201
- ORD-002 非 .xlsx → 400；ORD-003 列名不匹配 → FAILED 零写入
- ORD-004 省份错误 → FAILED + 错误报告；ORD-005 成功导入（金额分/业务月份/费率快照 12%/毛利润 12000）
- ORD-006 幂等键返回原批次；ORD-007 重复文件（哈希+最大下单时间）→ 400
- ORD-008/009 负金额 -50.00 与 0 入账；ORD-010 超额 90 万不阻断
- ORD-011 admin 作废 403 / super 作废+恢复（状态/原因/时间）
- ORD-013 city_user 手机号脱敏 / super 完整
- ORD-014 临时文件任务后清理；ORD-015 真实文件 70591 行受控验证（结构通过、业务校验失败、7 万错误分块保存）
- ORD-016 **20 万行性能：size=263.7MB、parse+import=82s（<120s 阈值）**

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；脚本已更新（14 迁移）待执行 | M1-M4 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | 已确认"仅电商版 34 列"，非电商留待业务确认 |
| NEW-M4 | 20 万行解析 82s（SQLite；MySQL 预计更快）；ORD-016 经 ORDER_UPLOAD_MAX_BYTES 环境开关放宽上传限制（生产不设置，默认 50MB） | 性能优化可延后（阈值 120s 内） |

## 6. 下一里程碑（M5 线下完工与成本域）计划

按基线 09 表 10（DEV-038 ~ DEV-045）：

1. **DEV-038** 线下完工列表/详情/新增/编辑/撤回 API（地市用户本地范围）
2. **DEV-039** 提交审核：金额 >0、月份不得未来、合同已分配本地市、未超额不阻断
3. **DEV-040** 审核通过/驳回（super_admin/admin；重新校验合同状态与分配关系；版本号并发）
4. **DEV-041** 已通过作废 + 恢复（权限、原因必填、操作日志）
5. **DEV-042** 地市成本列表/新增/提交/审核/驳回/作废/恢复（不关联合同，分类必填）
6. **DEV-043** 成本审核授权（默认 super_admin，可授权 admin）
7. **DEV-044** 完工/成本页面（列表/筛选/状态操作）
8. **DEV-045** 状态机/权限/超额/并发/金额约束测试（OFF-001~010、CST-001~008）

**M5 前置**：复用 M2 权限守卫（completion/cost 权限码已在 012 种子）、M3 getEffectiveRate（完工费率快照）、M4 合同进度聚合（完工入账自动更新进度与两级超额）。
