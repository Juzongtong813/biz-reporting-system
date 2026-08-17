# M8 收口与退役里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-16
> 阶段：M8「收口与退役」
> 结论：**M8 修复验收（2026-08-17 撤回旧"验收通过"结论后重新验收）：10 项修复全部完成并全量验证通过；预检 PASS（含正式 gate）；发布候选评审前须经治理负责人 codex 复核**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-064 | 生产配置审计：JWT/HMAC 弱密钥（长度<32/占位/默认/重复字符）→ 生产启动失败、开发告警 | ✅ |
| DEV-065 | 旧 facts/报表包/AI 退役隔离（只读隐藏不删代码；facts 写接口返回 410）；BLK-2 退役隔离证明与风险豁免（M8-legacy-retirement.md） | ✅ |
| DEV-066 | super_admin 运维闭环：env 注入初始化（禁默认密码，弱密码拒绝）、轮换（重置密码）、停用（令牌失效/登录 401）、审计（操作审计 Tab + GET /biz/admin/operation-logs）、应急恢复流程（runbook §9） | ✅ |
| DEV-067 | 生产 MySQL 完整验证（192.168.1.197:34001，001-015，16 条账本，M2/M3/M5/M6/M8 集成 5/5） | ✅ PASS |
| DEV-068 | 发布预检：scripts/release/preflight.mjs（checksum/迁移账本/密钥审计/正式 MySQL gate/12 测试套件/BLK 清单）→ **PREFLIGHT_PASS** | ✅ PASS |

## 2. 修改文件

### 新增（5）
- `scripts/test/run-m8-security.mjs`（弱密钥 + 运维闭环测试）
- `scripts/release/preflight.mjs`（发布预检）
- `docs/baseline/M8-legacy-retirement.md`（退役隔离证明 + BLK-2 豁免）
- `docs/baseline/release-preflight-report.md`（预检报告）
- 前端 `BizAdmin.tsx` 操作审计 Tab

### 修改（4）
- `apps/api/src/auth/jwt.config.ts`（assertSecretStrength 弱密钥检测）
- `apps/api/src/biz-auth/biz-admin.controller.ts`（GET operation-logs 审计端点）
- `apps/admin-web/src/api/biz.api.ts`（bizOperationLogs）
- `docs/baseline/M7-runbook.md`（§9 super_admin 运维流程）+ `package.json`（test:m8-security / release:preflight）

## 3. 数据库迁移

M8 追加迁移 `015_import_job_legacy_fields`，当前共 16 条迁移（001-015，含两个 002 版本）；checksum 全一致。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit / architecture / m2 / m3 / m5 / m6 / m7 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m8-security`**（新增） | ✅ 弱密钥+运维闭环 |
| **`pnpm release:preflight`**（新增） | ✅ PREFLIGHT_PASS（checksum/ledger/secrets/formal MySQL gate/tests 12/12） |
| `pnpm test:migrations:mysql` | ✅ PASS（正式非 localhost gate） |

**验收要点**：
- 生产 + 短密钥 / 占位密钥（secret、changeme）→ 启动失败（进程非 0 退出 + SECURITY_CONFIG 报错）
- 开发 + 弱密钥 → 启动成功 + 告警
- super_admin 初始化仅接受 env 注入强密码；脚本拒绝弱密码（123456）
- 轮换（重置密码）后新密码可登录；停用后登录 401
- 操作审计可查（创建/重置/停用/作废/审核动作）
- BLK-2 处置：退役隔离证明 + 风险豁免（非静默跳过）
- BLK-3 继续登记为 M4 范围外事项

## 5. 未解决问题（发布判定）

| ID | 状态 | 说明 |
|---|---|---|
| BLK-1 | **resolved** | 正式 MySQL gate 已通过；16 条迁移、失败账本、幂等、临时库清理及 M2/M3/M5/M6/M8 集成均通过 |
| BLK-2 | mitigated-by-retirement | 退役隔离证明 + 风险豁免（M8-legacy-retirement.md） |
| BLK-3 | accepted-out-of-scope | 非电商订单模板变体（M4 范围外，已登记） |

## 6. 发布候选判定（DevOps）

M8 完成后进入发布候选需同时满足：
1. `pnpm release:preflight` PASS（已达成）
2. `pnpm test:migrations:mysql` 通过（迁移 001-015 + 集成测试在真实 MySQL8 全跑）
3. 生产环境密钥审计通过（预检已含静态扫描；上线前再核验 env 实际值）
4. 部署验证按 M7-runbook 执行（SQLite→MySQL 切换、初始管理员、回滚演练）
## DEV-067 正式 gate 复验（2026-08-16）

正式非 localhost 实例 `192.168.1.197:34001`（MySQL 8.0.46）已通过 `node scripts/test/run-migrations-mysql.mjs`；五套 MySQL 集成测试输出 `MYSQL_INTEGRATION_GATE_PASS 5/5`，随后当前提交下 `pnpm release:preflight` 输出 `PREFLIGHT_PASS ... tests=12/12`。

## M8 最终验收结论（2026-08-16）

以上历史段落由本节最终证据 supersede：

- DEV-067：PASS。正式非 localhost MySQL `192.168.1.197:34001` / 8.0.46 通过 001-015 共 16 条迁移、二次幂等、失败账本和临时库清理；M2/M3/M5/M6/M8 集成 `5/5 PASS`。
- DEV-068：PASS。当前提交下 `pnpm release:preflight` 输出 `PREFLIGHT_PASS checksum=true ledger=true secrets=true tests=12/12`。
- BLK-1：RESOLVED。BLK-2 仍为 `mitigated-by-retirement`，BLK-3 仍为 `accepted-out-of-scope`。

结论：M8 验收通过，允许进入发布候选评审。正式发布仍须按 M7-runbook 完成部署环境核验；本结论不扩大 BLK-2/BLK-3 的既有处置范围。


---

## M8 修复验收（2026-08-17，DEV-067 复验后补充）

### 撤回说明
2026-08-17 治理指令：暂停发布候选评审，撤回此前"M8 已验收通过、仅剩密钥和部署演练"的结论。按 10 项清单修复后重新提交验收。

### 修复清单（全部完成并验证）
1. **线下完工费率快照与毛利**：完工提交时按 合同+地市+业务月份 固化 fee_rate_snapshot_bp 并计算 gross_profit_fen（迁移 016）；汇总/合同详情毛利 = (订单+完工)×费率，符合 golden-samples.json（MET-003）；M6 测试断言对齐 golden（AGG-001/006）。
2. **分析/详情数据范围过滤**：概览/趋势/地市/超额/合同详情统一 all/province/city 过滤（contract scope 拒绝分析域）。
3. **完工/成本写操作范围校验**：update/approve/reject/void/restore 目标记录与新 cityId 校验；contract scope 拒绝。
4. **订单上传硬限制**：仅 super_admin/admin（role 级，override 不可绕过）；批次固化上传人范围快照（迁移 017），行级省份/地市范围校验（超范围整批回滚+错误报告）。
5. **省级重算修复**：线下完工表无 province_id，省级范围用 city→province 子查询过滤。
6. **地市超额按 contractId+cityId 汇总**（与分配额度同粒度）。
7. **批次详情范围收敛**：非上传者按范围校验；上传者可查看自己上传的失败批次。
8. **经营首页补齐**：组合筛选（月份/地市）、CSV 导出、超额提醒条、完整地市指标（订单/线下/毛利/成本/净利/超额标记）。
9. **负向测试**（test:m9-negative）：线下利润、省级重算、跨地市 403、权限覆盖（override 不可绕过 role 硬限制）、混合批次（整批回滚+scope 错误+上传者可见）。
10. **全量验证**：typecheck/build 4 包、unit 20、architecture 0 违规、ledger 18、M2/M3/M5/M6/M7/M8/M9 全套、MySQL 本地迁移 18、MySQL 集成 6/6（gate）、正式 gate（001-017 ISOLATION_OK）、preflight PASS（含 gate env，BLK-1 resolved）。

### 迁移新增
- 016_biz_offline_rate_snapshot（完工费率快照+毛利）
- 017_biz_order_batch_scope（批次上传范围快照）
- 账本 18 条（001-017 含 002 双文件）；001-014 不可变，015-017 追加
