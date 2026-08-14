# M3 合同域里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-14
> 阶段：M3「合同域」
> 结论：**M3 完成（SQLite 全验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-020 | 合同 CRUD API（合同号服务端唯一 + DB 唯一索引兜底；UUID；金额整数分） | ✅ |
| DEV-021 | 状态机：草稿完整性校验 → 生效（amountLocked 锁定合同额）→ 完成（进度≥100%）/ 作废（汇总口径+原因必填）；恢复仅 super_admin | ✅ |
| DEV-022 | 补充合同（parent_contract_id 独立编号/额度/费率，仅关系查看） | ✅ |
| DEV-023 | 地市分配：额度合计 ≤ 合同额、预留额度、降低额度、取消分配（仅 super_admin） | ✅ |
| DEV-024 | 费率历史（合同+地市+生效月份唯一；0<rate≤100%）；getEffectiveRate 按业务月份取快照（历史不回溯） | ✅ |
| DEV-025 | 合同详情聚合 API（基础/分配/费率/预警/进度/来源汇总；进度允许 >100% + 两级超额动态计算） | ✅ |
| DEV-026 | 合同管理页面 + 全屏详情弹窗（页签：基本信息/地市分配/费率记录/完工进度） | ✅ |
| DEV-027 | CON-001~010 + STA-001 + 权限/费率快照/数据范围/超额测试 | ✅ |

## 2. 修改文件

### 新增（5）
- `apps/api/src/biz-contracts/biz-contracts.service.ts`（合同域核心服务）
- `apps/api/src/biz-contracts/biz-contracts.controller.ts`（合同 API）
- `apps/api/src/biz-contracts/biz-contracts.module.ts`
- `apps/admin-web/src/pages/biz/BizContracts.tsx`（列表 + 全屏详情）
- `scripts/test/run-m3-contracts.mjs`（CON-001~010 集成测试）

### 修改（4）
- `apps/api/src/app.module.ts`（注册 BizContractsModule）
- `apps/admin-web/src/App.tsx`（/biz/operation → 合同管理页）
- `apps/admin-web/src/api/biz.api.ts`（合同 API 客户端）
- `package.json`（test:m3-contracts）

## 3. 数据库迁移

**M3 无新增迁移**：合同域 4 张表（biz_contracts / biz_contract_city_allocations / biz_contract_fee_rates / biz_contract_alerts）已在 M1 迁移 010 建立，本次仅实现服务层与校验，符合「无结构变化不追加迁移」原则。后续若 M4/M5 需要新表，从 013 起追加。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（4 包）/ `pnpm build`（4 包） | ✅ |
| `pnpm test:unit` / `architecture` / `migrations:ledger` / `baseline-smoke` | ✅ |
| `pnpm test:m2-rbac-auth` | ✅ 回归 |
| **`pnpm test:m3-contracts`**（新增） | ✅ CON-001~010 全过 |
| `pnpm test:auth-v3` / `exports-v3` / `metric-sources` / `storage-gate` | ✅ 零回归 |
| `pnpm migration-files:check` | ✅ 13 迁移 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

**M3 验收覆盖（test:m3-contracts 断言）**：
- CON-001 合同号重复 → 400（服务端 + DB 唯一）
- CON-002 不完整草稿可保存；生效 → 400 并列出缺失字段
- CON-003 生效后 amountLocked=true；修改合同额 → 400
- CON-004 作废（口径+原因必填）；已作废再作废 → 400（STA-001）；重建新合同号 OK
- CON-005 补充合同 parent_contract_id 关联
- CON-006 额度合计 600k+400k=1000k OK；700k+400k=1100k>1000k → 400
- CON-007 合法范围内降低额度 OK
- CON-008 取消分配：admin → 403；super_admin → 200
- CON-009 超额真实入账：插入 1200k 订单 → 进度 120%、合同超额 200k、地市超额 100k
- CON-010 详情聚合完整结构（基础/分配/费率/预警/进度）
- 费率快照：2026-01 10% → 2026-02 用 10%；2026-05 新增 12% → 2026-04 仍 10%（历史不回溯）；2026-05 用 12%；重复（合同+地市+月份）→ 400
- 数据范围：city_user 仅见已分配本地市合同（德州专属合同不可见）
- 权限：contract_manager 可列合同

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；脚本已更新（13 迁移）待执行 | M1/M2/M3 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | M4 已确认"仅电商版 34 列" |
| NEW-M3 | 费率快照 90 天到期阈值暂硬编码 3 个月（super_admin 系统设置 M6/M8 收口）；降低额度"不得低于已生效完工金额"校验待 M5 完工域接入 | M5/M6 |

## 6. 下一里程碑（M4 订单域）计划

按基线 09 表 9（DEV-028 ~ DEV-037）：

1. **DEV-028** 固化真实订单模板 34 列常量（已建）+ 敏感字段/F 列/下单时间映射
2. **DEV-029** 上传入口改造：仅 super_admin/admin、.xlsx、单工作表、50MB、20 万行
3. **DEV-030** 临时文件存储与异步任务；成功/失败后删除，不提供原文件下载
4. **DEV-031** 重写解析器：列名/列数/顺序完全匹配；34 列原值 + 标准化字段
5. **DEV-032** 省份/地市/合同/分配/时间整批校验；任一错误零业务行写入
6. **DEV-033** 请求幂等（idempotency_key 返回原批次）+ 文件哈希+最大下单时间防重
7. **DEV-034** 移除业务去重；正数/零/负数全部入账；两级超额不阻断导入
8. **DEV-035** 批次生效、作废、super_admin 恢复（保留原始行/操作账号/时间，重算超额）
9. **DEV-036** 订单上传进度/结果/错误/列表/超额筛选页面
10. **DEV-037** 解析/事务/幂等/负数/超额/真实 Excel/20 万行性能测试（ORD-001~016）

**M4 前置**：M3 已提供 getEffectiveRate（费率快照）；010 已建 biz_order_import_batches / biz_order_rows / biz_order_import_errors；真实订单文件受控哈希已登记（real-excel-registry.md）。
