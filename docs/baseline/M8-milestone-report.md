# M8 收口与退役里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M8「收口与退役」
> 结论：**M8 验收通过（正式 MySQL gate + 发布预检 PASS）；进入发布候选评审**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-064 | 生产配置审计：JWT/HMAC 弱密钥（长度<32/占位/默认/重复字符）→ 生产启动失败、开发告警 | ✅ |
| DEV-065 | 旧 facts/报表包/AI 退役隔离（只读隐藏不删代码 + 回退保留）；BLK-2 退役隔离证明与风险豁免（M8-legacy-retirement.md） | ✅ |
| DEV-066 | super_admin 运维闭环：env 注入初始化（禁默认密码，弱密码拒绝）、轮换（重置密码）、停用（令牌失效/登录 401）、审计（操作审计 Tab + GET /biz/admin/operation-logs）、应急恢复流程（runbook §9） | ✅ |
| DEV-067 | 生产 MySQL 完整验证（192.168.1.197:34001，001-015，16 条账本，M2/M3/M5/M6/M8 集成 5/5） | ✅ PASS |
| DEV-068 | 发布预检：scripts/release/preflight.mjs（checksum/迁移账本/密钥审计/12 测试套件/BLK 清单）→ **PREFLIGHT_PASS** | ✅ PASS |

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
| **`pnpm release:preflight`**（新增） | ✅ PREFLIGHT_PASS（checksum/ledger/secrets/tests 12/12） |
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
