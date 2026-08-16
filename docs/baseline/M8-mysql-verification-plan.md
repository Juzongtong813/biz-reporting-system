# M8 真实 MySQL 8 完整验证计划（BLK-1 解除后执行清单）

> 状态：**已执行（正式 gate PASS，BLK-1 已解除）**
> 验收结论（2026-08-16）：DEV-067 正式 MySQL 验证通过，M8 预检 12/12 通过；基线提交 `738e06e`，后续修订提交见 git log。
> 本清单已完成；后续重跑仍须使用非 localhost 隔离实例和临时库，禁止把本地 localhost 结果冒充正式 gate。

---

> 当前修订（2026-08-16）：DEV-067 已通过正式非 localhost MySQL gate；当前账本为 16 条（001-015，含 002 双文件），BLK-1 已解除。本文前段的 BLOCKED、15 条账本和 CLOSED 记录均为历史快照，以文末正式 gate 记录为准。

## 0. 前置

- 隔离 MySQL 8 实例（版本 ≥ 8.0，utf8mb4，时区建议 +08:00 或显式配置）
- 环境变量：`MIGRATION_TEST_MYSQL_HOST / _PORT / _USER / _PASSWORD`（`run-migrations-mysql.mjs` 依赖，缺失即报错防误跑）

## 1. 全新空库迁移 001～015（checksum / 账本 / 二次幂等）

```bash
# 1a. 创建空库（隔离实例，UTF8MB4）
#    CREATE DATABASE biz_reporting CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 1b. 执行迁移（首次）
MIGRATION_TEST_MYSQL_HOST=<host> MIGRATION_TEST_MYSQL_PORT=3306 \
MIGRATION_TEST_MYSQL_USER=<user> MIGRATION_TEST_MYSQL_PASSWORD=<pass> \
pnpm test:migrations:mysql
# 预期：MIGRATE_OK dialect=mysql migrations=16；ledger 16 行（001-015，含 002 双文件）

# 1c. 二次幂等（重复执行迁移账本校验）
#    migrate.mjs up 对已 applied 迁移跳过；checksum 校验通过
#    断言：重复执行后表数量/账本行数不变，无重复建表错误
```

**验收断言**：
- 迁移文件 checksum 与 `scripts/db/migration-checksums.json` 一致（`pnpm migration-files:check`）
- 账本 `migration_ledger` 16 行，001-015 全部 applied
- 二次执行幂等：无重复建表/列错误；inspectState 全绿

## 2. 核心 CRUD / 状态机 / 权限 / 事务 / 唯一约束 / 乐观锁 / 汇总

复用 SQLite 已通过的全部集成测试（同一套测试代码、环境切到 MySQL）：

```bash
# 启动 API（DB_TYPE=mysql 指向隔离实例）
NODE_ENV=test DB_TYPE=mysql DB_HOST=<host> DB_PORT=3306 DB_USERNAME=<user> \
DB_PASSWORD=<pass> DB_DATABASE=biz_reporting DB_SYNC=false \
PORT=0 node apps/api/dist/main.js &

# 逐套运行（均为隔离临时库 + 真实 API 集成）
pnpm test:m2-rbac-auth     # 四角色/锁定/停用/数据范围（权限与状态）
pnpm test:m3-contracts     # 合同状态机/费率历史/超额（事务+唯一约束 uk_contract_no）
pnpm test:m5-offcost       # 完工/成本状态机 + @VersionColumn 乐观锁
pnpm test:m6-aggregates    # 汇总计算/重算/一致性核对（聚合 SQL）
pnpm test:m7-views         # 前端全链路（登录→六模块；独立浏览器/UI 验证，不计入 MySQL 集成套件）
pnpm test:m8-security      # 弱密钥 + super 运维闭环
```

**验收断言**（MySQL 特有关注点）：
- 唯一约束：`uk_biz_contract_no`（重复合同号拒绝）、分配/费率唯一、批次幂等唯一、fingerprint 唯一
- 乐观锁：`version_no` 并发更新冲突（更新 0 行 → 拒绝）
- 事务：订单导入整批回滚（任一错误零写入）；汇总重算事务
- 状态机非法跳转拒绝；权限矩阵 403

## 3. 整数分 / UUID / 时区 / 字符集 / 长文本与 JSON

| 项 | 断言 |
|---|---|
| 整数分 | 金额 BIGINT（分）：100.00 → 10000；负金额入账；SUM 无浮点误差 |
| UUID | 主键为 UUID 字符串（36 位），非自增；合同号业务唯一键独立 |
| 时区 | 下单时间解析与 `business_month`（YYYY-MM）按本地时区正确；DATETIME 存取一致 |
| 字符集 | 中文（省份/地市/合同名/收货人/地址）读写无损（utf8mb4，emoji/生僻字可入） |
| 长文本/JSON | `source_row_json` 34 列原值完整存取；错误报告长文本（500+ 字）不截断 |

**执行方式**：上述集成测试已覆盖中文/UUID/分/时间；补充一次"长文本+emoji+生僻字"订单导入与 JSON 回读断言（可在 m4 真实文件验证中加一列含 emoji 的用例）。

## 4. 重新运行 release:preflight（实例版本/命令/日志/报告留档）

```bash
pnpm release:preflight 2>&1 | tee /tmp/m8-preflight-mysql.log
```

**验收断言**：
- PREFLIGHT_PASS（checksum / 账本 / 密钥审计 / 12 测试套件全绿）
- 留档：实例版本（`SELECT VERSION()`）、执行命令、日志摘要、最终报告 `docs/baseline/release-preflight-report.md`

## 5. 收口

全部通过后：
1. 更新 `docs/baseline/M8-milestone-report.md`：DEV-067 标记完成、BLK-1 解除、结论改为"M8 完成（真实 MySQL 验证通过）"
2. 新增提交（追加式，不改 738e06e 基线）
3. 形成发布候选（配合 M7-runbook 部署验证）

---

## 阻塞记录

| 日期 | 说明 |
|---|---|
| 2026-08-15 | 本机 127.0.0.1:34001（隔离 gate）CLOSED；127.0.0.1:3306 有 MySQL 但凭据不可用（非项目实例）；无法执行第 1-5 项。M8 保持 BLOCKED。 |
# DEV-067 执行记录与当前结论（2026-08-16）

本地隔离 MySQL 8.0.46（127.0.0.1:34001）已完成迁移 001-015、16 条账本、二次幂等、失败账本和 M2/M3/M5/M6/M8 集成测试；该结果仅标记为 `local-isolated/non-gate`，当时不满足正式 gate 要求。其后正式非 localhost gate 已通过，见下文记录。

更正早期记录：`127.0.0.1:34001` 当前可用，不是 CLOSED；已记录 `VERSION()=8.0.46`、`@@port=34001`、`CURRENT_USER()=biz_migration_test@127.0.0.1`。正式 gate 的 localhost 拒绝行为保持不变。

执行记录：使用 `node scripts/test/run-m8-mysql-local.mjs` 完成临时库 001-015 迁移与二次幂等；使用 `node scripts/test/run-migrations-mysql-local.mjs` 完成 47 项等价本地 gate 断言（含失败账本）；使用 `node scripts/test/run-mysql-integration.mjs` 完成五套独立临时库集成测试，结果 `5/5 PASS`。日志摘要为 `MIGRATE_OK dialect=mysql migrations=16`、`MYSQL_MIGRATION_ISOLATION_OK`、`MYSQL_MIGRATION_FAILURE_LEDGER_OK`、`MYSQL_INTEGRATION_LOCAL_PASS 5/5`；上述均为 `local-isolated/non-gate` 证据，正式 gate 与 `release:preflight` 待非 localhost 实例及受控依赖环境后执行。

正式 gate 补充记录：将环境变量切换为 `MIGRATION_TEST_MYSQL_HOST=192.168.1.197`、端口 `34001`、账号 `biz_migration_gate` 后，`node scripts/test/run-migrations-mysql.mjs` 通过；`node scripts/test/run-mysql-integration.mjs` 输出 `MYSQL_INTEGRATION_GATE_PASS 5/5 (formal-non-local-gate)`。此前 local 记录仍保留，以上正式记录 supersede 其 DEV-067 判定。

当前收口：DEV-067 / BLK-1 的正式 MySQL 条件已满足；已在当前提交重跑 `pnpm release:preflight`，结果为 `PREFLIGHT_PASS checksum=true ledger=true secrets=true tests=12/12`。

历史预检阻塞：`xlsx@0.20.3` 缺少 integrity 的供应链问题已由锁文件补齐官方 tarball integrity 解决；`pnpm install --frozen-lockfile` 已通过。
