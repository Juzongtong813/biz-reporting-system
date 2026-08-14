# M5 线下完工与成本域里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M5「线下完工与成本域」
> 结论：**M5 完成（SQLite 全验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-038 | 线下完工 CRUD API（地市用户仅本地市；admin 数据范围校验） | ✅ |
| DEV-039 | 提交校验：金额 >0、业务月份非未来、合同已分配本地市且未作废 | ✅ |
| DEV-040 | 审核通过/驳回（super_admin/admin；重新校验合同与分配；@VersionColumn 乐观锁并发） | ✅ |
| DEV-041 | 已通过作废 + 恢复（原因必填、操作日志、退出/恢复统计） | ✅ |
| DEV-042 | 地市成本全流程（不关联合同；分类必填；金额 >0；月份非未来） | ✅ |
| DEV-043 | 成本审核授权（operation.cost.approve：默认仅 super_admin，可经账号例外授权 admin） | ✅ |
| DEV-044 | 完工/成本页面（列表/新建/提交/审核/作废/恢复） | ✅ |
| DEV-045 | OFF-001~010 + CST-001~008 测试 | ✅ |

## 2. 修改文件

### 新增（8）
- `apps/api/src/biz-completions/`（service + controller + module）
- `apps/api/src/biz-costs/`（service + controller + module）
- `apps/admin-web/src/pages/biz/BizOfflineCompletions.tsx`、`BizCosts.tsx`
- `scripts/test/run-m5-offcost.mjs`（OFF-001~010 + CST-001~008）

### 修改（5）
- `apps/api/src/completions/biz-offline-completion.entity.ts`、`apps/api/src/costs/biz-cost-entry.entity.ts`：version_no → @VersionColumn（乐观锁；列已在 010，无需迁移）
- `apps/api/src/app.module.ts`（注册 BizCompletionsModule/BizCostsModule）
- `apps/admin-web/src/App.tsx`（/biz/offline-completions、/biz/costs 路由）+ `api/biz.api.ts`（API 函数）
- `package.json`（test:m5-offcost）

## 3. 数据库迁移

**M5 无新增迁移**：完工/成本表已在 010 建立；version_no 列已存在（仅实体注解改为 @VersionColumn，不改变表结构）。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit(20) / architecture / ledger(14) / baseline-smoke / m2 / m3 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m5-offcost`**（新增） | ✅ OFF-001~010 + CST-001~008 全过 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

**验收要点**：
- OFF-001 地市用户传其他地市 → 403；本地市 OK
- OFF-002 金额 0 / 未来月份 / 未知合同 → 400
- OFF-004 city_user 无审核权限 → 403
- OFF-005 审核通过（重新校验合同状态与分配）
- OFF-006 驳回原因必填；驳回后可编辑重新提交
- OFF-007 作废原因必填、city_user 无权限；OFF-008 恢复
- OFF-009 版本保护：旧版本更新命中 0 行（乐观锁 WHERE version_no）
- OFF-010 非提交人撤回 → 403
- CST-001 成本无 contractId 字段；CST-002 分类必填/不存在 → 400
- CST-003 负金额/未来月份 → 400
- CST-004 admin 默认无 cost.approve → 403；**授权例外后重新登录 → 审核通过**（DEV-043）
- CST-005 驳回原因必填；CST-006 作废/恢复；CST-007 状态机非法跳转 → 400
- CST-008 成本版本保护（命中 0 行）

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；脚本已更新（14 迁移）待执行 | M1-M5 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | 已确认"仅电商版 34 列"，非电商留待业务确认 |
| NEW-M5 | M4 20 万行性能 82s 作为当前基线（不阻塞）；完工/成本审核在 012 权限矩阵内（admin 默认有 completion 审核、无 cost 审核） | 后续优化 |

## 6. 下一里程碑（M6 经营管理汇总）计划

按基线 09 表 11（DEV-046 ~ DEV-055）：

1. **DEV-046** 汇总生成规则：明细汇总（订单+线下完工-作废）→ 月度/累计维度聚合（省/地市/合同）
2. **DEV-047** 汇总调度：新增/变更/作废明细触发增量重算；异常记录（biz_aggregate_failures）不删除明细
3. **DEV-048** 汇总校验：科目=订单+完工、利润=收入-成本、两级超额标识
4. **DEV-049** 成本/收入/毛利/净利/超额分析聚合 API（按省/地市/合同/月份钻取）
5. **DEV-050** 汇总重算：super_admin/admin 手工触发（默认只重算失败范围；全库需二次确认）
6. **DEV-051** 汇总与明细一致性核对任务（运行后不同步给警告，不自动改数据）
7. **DEV-052** 经营分析页面（概览卡片/趋势/地市对比/超额清单）
8. **DEV-053** 合同详情聚合接入完工+成本（进度/超额完整）
9. **DEV-054** 汇总/重算/一致性/越权测试（AGG-001~008、REC-001~003、CNS-001~003）
10. **DEV-055** 系统设置页（费率到期预警阈值、成本审核授权说明）——设置存储表追加迁移

**M6 前置**：M3 合同进度聚合、M4 订单入账、M5 完工/成本已齐；biz_monthly_aggregates / biz_aggregate_failures / biz_recalc_tasks 表已在 010 建立。
