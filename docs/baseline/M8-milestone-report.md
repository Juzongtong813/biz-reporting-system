# M8 收口与退役里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M8「收口与退役」
> 结论：**M8 预检完成（SQLite 全验证 + 发布预检 PASS）；DEV-067 受 BLK-1 阻塞——真实 MySQL 完整验证通过前不得宣布 M8 完成、不得形成发布候选**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-064 | 生产配置审计：JWT/HMAC 弱密钥（长度<32/占位/默认/重复字符）→ 生产启动失败、开发告警 | ✅ |
| DEV-065 | 旧 facts/报表包/AI 退役隔离（只读隐藏不删代码 + 回退保留）；BLK-2 退役隔离证明与风险豁免（M8-legacy-retirement.md） | ✅ |
| DEV-066 | super_admin 运维闭环：env 注入初始化（禁默认密码，弱密码拒绝）、轮换（重置密码）、停用（令牌失效/登录 401）、审计（操作审计 Tab + GET /biz/admin/operation-logs）、应急恢复流程（runbook §9） | ✅ |
| DEV-067 | 生产 MySQL 完整验证 | ⛔ BLOCKED（BLK-1） |
| DEV-068 | 发布预检：scripts/release/preflight.mjs（checksum/迁移账本/密钥审计/12 测试套件/BLK 清单）→ **PREFLIGHT_PASS**（仅预检，非发布候选） | ✅ |

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

M8 无新增迁移（15 个迁移保持；checksum 全一致）。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit / architecture / m2 / m3 / m5 / m6 / m7 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m8-security`**（新增） | ✅ 弱密钥+运维闭环 |
| **`pnpm release:preflight`**（新增） | ✅ PREFLIGHT_PASS（checksum/ledger/secrets/tests 12/12） |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

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
| BLK-1 | **open（不可豁免）** | 隔离 MySQL 8 未提供；`test:migrations:mysql` 待实例到位后补跑 M1-M8 迁移与集成验证；**通过前不宣布 M8 完成、不形成发布候选** |
| BLK-2 | mitigated-by-retirement | 退役隔离证明 + 风险豁免（M8-legacy-retirement.md） |
| BLK-3 | accepted-out-of-scope | 非电商订单模板变体（M4 范围外，已登记） |

## 6. 发布候选判定（DevOps）

M8 完成后进入发布候选需同时满足：
1. `pnpm release:preflight` PASS（已达成）
2. `pnpm test:migrations:mysql` 通过（BLK-1 解除后：迁移 001-014 + 集成测试在真实 MySQL8 全跑）
3. 生产环境密钥审计通过（预检已含静态扫描；上线前再核验 env 实际值）
4. 部署验证按 M7-runbook 执行（SQLite→MySQL 切换、初始管理员、回滚演练）
# DEV-067 当前验收更正（2026-08-15）

本地隔离 MySQL 8.0.46（127.0.0.1:34001）已完成 001-015 迁移、16 条账本、二次幂等、失败账本及 M2/M3/M5/M6/M8 五套集成测试，结果为 `local-isolated/non-gate PASS`。正式 `test:migrations:mysql` 仍因 localhost gate 拒绝，DEV-067/BLK-1 未解除；本报告不宣布 M8 完成或发布候选。

本次追加迁移 `015_import_job_legacy_fields`，用于补齐旧 `import_jobs` 实体读取的兼容字段；001-014 与既有 checksum 未修改。

说明：`release:preflight` 尚未在本次 015 变更后重跑；pnpm 依赖目录重建需要受控授权。因此旧版 PREFLIGHT_PASS 仅作历史证据，不能作为当前发布候选依据。

## DEV-067 正式 gate 复验（2026-08-16）

正式非 localhost 实例 `192.168.1.197:34001`（MySQL 8.0.46）已通过 `node scripts/test/run-migrations-mysql.mjs`；五套 MySQL 集成测试输出 `MYSQL_INTEGRATION_GATE_PASS 5/5`。BLK-1 的 MySQL 实例阻塞已解除，待 `release:preflight` 在本次变更后通过即可形成最终 M8 判定。

当前验收结论：DEV-067 = PASS，BLK-1 = RESOLVED；M8 仍未宣布完成，原因仅为当前 Codex 运行环境无法启动 pnpm 预检（缓存 SQLite 无法打开并触发自动 install）。
