# M6 经营管理汇总里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M6「经营管理汇总」
> 结论：**M6 完成（SQLite 全验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-046 | 汇总口径与生成：订单（非作废）+ 线下完工（已通过）- 作废退出；省/地市/合同/月份维度 + 累计动态求和 | ✅ |
| DEV-047 | 增量重算：明细变更（导入/作废/审核/恢复）自动触发；失败记录 biz_aggregate_failures 不删除明细 | ✅ |
| DEV-048 | 汇总校验：利润 = 毛利 - 成本（科目平衡）；两级超额标识动态计算 | ✅ |
| DEV-049 | 分析聚合 API：概览/月度趋势/地市对比/超额清单 | ✅ |
| DEV-050 | 手工重算：失败范围优先；全库需 confirmAll=true 二次确认 | ✅ |
| DEV-051 | 一致性核对：明细 vs 汇总差异列表（只告警不自动改写） | ✅ |
| DEV-052 | 经营分析页面（概览卡片/趋势/地市对比/超额清单/重算/核对） | ✅ |
| DEV-053 | 合同详情完整聚合：finance（成本/毛利/净利按分配地市汇总） | ✅ |
| DEV-054 | AGG-001~008、REC-001~003、CNS-001~003 测试 | ✅ |
| DEV-055 | 系统设置：迁移 014（biz_system_settings 表 + 3 项种子）；到期预警阈值收口（移除硬编码）；前端设置页 | ✅ |

## 2. 修改文件

### 新增（6）
- `apps/api/src/biz-aggregates/`（aggregate service + controller + module）
- `apps/api/src/aggregates/biz-system-setting.entity.ts`（设置实体）
- `apps/api/migration/014_biz_system_settings.sql`
- `apps/admin-web/src/pages/biz/BizAnalysis.tsx`、`BizSettings.tsx`
- `scripts/test/run-m6-aggregates.mjs`

### 修改（8）
- `apps/api/src/app.module.ts`（注册 BizAggregatesModule）
- `apps/api/src/biz-contracts/biz-contracts.service.ts`（detail 补 finance；预警阈值读设置）及 module（forFeature 补实体）
- `apps/api/src/biz-orders/biz-order-import.service.ts`（导入/作废/恢复触发增量重算）+ module
- `apps/api/src/biz-completions/biz-offline-completion.service.ts`（审核/作废/恢复触发）+ module
- `apps/api/src/biz-costs/biz-cost.service.ts`（审核/作废/恢复触发）+ module
- `apps/admin-web/src/App.tsx`（/biz/analysis、/biz/settings 路由）+ `api/biz.api.ts`
- `scripts/db/migrate.mjs`（inspectState 014）+ `migration-checksums.json`（追加 014）
- `scripts/test/run-migration-ledger-contract.mjs` / `run-migrations-mysql.mjs`（15 迁移）+ `package.json`

## 3. 数据库迁移

| 迁移 | 内容 | 状态 |
|---|---|---|
| 014_biz_system_settings | 系统设置表 + 3 项种子（到期预警 90 天 / 订单 20 万行 / 50MB） | ✅ SQLite applied |

checksum 已追加（014: `bf80769c…`），001-013 未动。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit(20) / architecture / ledger(15) / baseline-smoke / m2 / m3 / m5 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m6-aggregates`**（新增） | ✅ AGG/REC/CNS 全过 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

**验收要点**：
- AGG-001/002 汇总生成：合同维度（订单 200000.00 + 完工 50000.00 + 毛利 24000.00）+ 成本独立行（地市维度 30000.00）
- AGG-003/004 作废退出统计（订单批次/完工作废后归零）
- AGG-006 利润 = 毛利 - 成本（24000 - 30000 = -6000）
- AGG-008 超额清单（110 万 > 合同 100 万 → 超额 10 万；> 地市 60 万 → 超额 50 万）
- REC-001 全库重算无 confirmAll → 400；有失败时全库被拒（先失败范围）
- REC-002 city_user 无重算权限 → 403
- CNS-001 一致时无警告；CNS-002 篡改 net_profit 被检出；CNS-003 核对后数据未自动改写
- DEV-055 设置：3 项种子、admin 只读、super 可改；合同到期预警阈值从设置读取（硬编码 90 天已移除）
- DEV-053 合同详情 finance：成本 30000 / 毛利 132000 / 净利 102000

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；脚本已更新（15 迁移）待执行 | M1-M6 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | 已确认"仅电商版 34 列"，非电商留待业务确认 |
| NEW-M6 | 增量重算为全量重算的简化实现（明细变更后整库重算，量级小时可接受；大数据量需按范围优化）；成本按地市维度不拆分到合同（符合基线"成本不关联合同"） | 性能优化可延后 |

## 6. 下一里程碑（M7 前端收口与页面完善）计划

按基线 09 表 12（DEV-056 ~ DEV-063）：

1. **DEV-056** 一级/二级门户路由与登录页统一（新基线 /biz/ 路由为默认入口）
2. **DEV-057** 经营管理模块导航（合同/订单/完工/成本/分析/设置 六入口）
3. **DEV-058** 系统管理页完善（用户/角色/模块/权限例外/数据范围授权）
4. **DEV-059** 前端权限控制（按权限码渲染按钮/菜单；无权限 403 页）
5. **DEV-060** admin-web 构建与部署配置（Vite base、环境变量、.env.production 收口）
6. **DEV-061** 旧页面清理评估（旧系统/报表包/AI/小程序入口标记废弃）
7. **DEV-062** 前端回归（导航/权限/CRUD 全链路 E2E 或手动清单）
8. **DEV-063** 部署验证与运行手册（SQLite→MySQL 切换、环境变量、初始账号）

**M7 前置**：M2-M6 已提供完整后端 API（认证/合同/订单/完工/成本/汇总/设置/权限管理）；前端 /biz/ 路由段已建 8 个页面。
