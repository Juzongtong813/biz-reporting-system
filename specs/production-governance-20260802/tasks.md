# WorkBuddy 全量治理执行清单

> 规格编号：PG-20260802  
> 状态：`TASKS_APPROVED`  
> 用户确认：2026-08-02 经总治理负责人 Codex 与项目所有者批准，三方治理机制（最终授权人 / Codex / WorkBuddy）生效；安全止血优先于短时可用性。  
> 日期：2026-08-02  
> 上位文件：`requirements.md`、`design.md`  
> 当前发布结论：`NO_GO`  
> 总治理负责人/唯一验收人：Codex  
> 执行官：WorkBuddy  
> 最终授权人：项目所有者  
> 本文件效力：任务计划获批前不得执行；获批后也不自动授权生产写入、数据删除、凭据轮换、部署或切流。

## 0. 执行规则

### 0.1 状态规则

- 任务只有 `PLANNED -> APPROVED -> IN_PROGRESS -> REVIEW -> PASS` 五个正常状态。
- 任何异常进入 `BLOCKED`，不能跳过后继续依赖任务。
- WorkBuddy 只能把任务交付到 `REVIEW`；只有 Codex 可以标记 `PASS`。
- 只有前置任务全部 `PASS`，下一任务才可由 Codex 标记 `APPROVED`。
- 任一任务的代码、测试或证据变化后，原 PASS 自动失效，必须重新验收。

### 0.2 授权级别

| 级别 | 范围 | 计划批准后的权限 |
|---|---|---|
| L0 | 本地只读检查 | 可由 Codex开放 |
| L1 | 本地文档、测试、代码和隔离构建 | 可由 Codex逐项开放 |
| I1 | 隔离 MySQL、隔离存储、隔离 CloudRun/Hosting 写入 | 必须明确目标后由最终授权人批准 |
| P0 | 生产资源只读、日志与配置查询 | 必须逐项获得最终授权人批准 |
| P1 | 生产权限、数据、密钥、部署、流量和删除 | 每个动作单独获得最终授权人即时批准 |

任务计划整体批准不等于 I1/P0/P1 批准。

### 0.3 每项任务的固定流程

1. Codex 发出任务卡，声明具体影响文件、字段、权限、契约或行为。
2. WorkBuddy 回读 task ID、pathspec、禁止事项、验证命令和授权级别。
3. WorkBuddy 保存执行前 `git status --short` 和目标文件 hash。
4. 先产生设计规定的旧代码失败证据，再修改实现。
5. 只修改任务列出的 pathspec；发现额外文件需求立即停工。
6. 运行任务级验证，提交 diff、命令退出码、关键输出和证据路径。
7. Codex 独立复核 diff 和证据，标记 PASS 或退回。

### 0.4 全局禁止事项

- 禁止 `git add .`、`git add -A`、自动 commit、push、merge、rebase、deploy。
- 禁止删除或覆盖用户已有修改、未跟踪文件、生产对象、日志、镜像和数据库记录。
- 禁止修改 001-008 历史迁移和既有 checksum。
- 禁止 `any`、`as any`、`@ts-ignore`、`@ts-nocheck`、空 catch、跳过失败测试。
- 禁止把姓名、openid、用户名、IP、密码、JWT、连接串和签名 URL 写入 Git 或证据摘要。
- 禁止把本地 SQLite、共享数据库或生产资源冒充隔离验收环境。
- 禁止 WorkBuddy 自行改变接口、状态机、阈值、IAM 或回滚方案。

### 0.5 偏差单模板

偏差文件：`specs/production-governance-20260802/deviations/DEV-<date>-<seq>.md`。

```text
任务编号：
发现时间：
现场事实：
与设计差异：
影响范围：
是否已修改文件/资源：
已执行回退：
建议方案：
WorkBuddy 状态：BLOCKED
Codex 裁决：
最终授权人决定：
```

## Phase A：治理冻结与安全事件

- [x] **A-01 校正规格状态并建立执行台账**
  - 状态：`REVIEW_COMPLETE`
  - 授权：L1。
  - 前置：任务计划整体批准。
  - 允许 pathspec：
    - `specs/production-governance-20260802/requirements.md`
    - `specs/production-governance-20260802/design.md`
    - `specs/production-governance-20260802/tasks.md`
    - `specs/production-governance-20260802/deviations/.gitkeep`
  - 步骤：
    1. 将 requirements 状态改为 `REQUIREMENTS_APPROVED`，记录 2026-08-02 用户确认。
    2. 将 design 状态改为 `DESIGN_APPROVED`，记录 2026-08-02 用户确认。
    3. 将 design 中根站入口“302/JS fallback”改为“meta refresh/JS fallback”。
    4. 在 design CloudRun 章节补充：P0 保持 `MaxNum=1`；接入共享 ThrottlerStorage 后才允许扩容。
    5. 计划批准后将 tasks 状态改为 `TASKS_APPROVED`，记录确认时间。
  - 禁止：修改任何业务代码或线上资源。
  - 验证：对 `requirements.md` 与 `design.md` 执行 `rg -n "PENDING_APPROVAL|302/JS"` 应只命中状态机示意；执行 `rg -n "URL不得"` 应无命中（“URL不得”为连写错误形态，正确形态为“URL 不得”；扫描范围限定在 requirements.md/design.md，排除本 tasks.md 验证命令自身以避免自命中）。
  - 证据：`evidence/governance/A-01-doc-status.txt`。
  - 验收：Codex 对三份文件 diff 逐行审阅。
  - _需求：PG-R13、PG-R14_

- [x] **A-02 冻结常规发布和导入写入口的治理权限**
  - 状态：`REVIEW_COMPLETE`
  - 授权：L0 制定矩阵；实际 IAM/功能冻结为 P1。
  - 前置：A-01 PASS。
  - 允许本地 pathspec：
    - `specs/production-governance-20260802/access-control-matrix.md`
    - `evidence/governance/A-02-access-redacted.json`
  - 步骤：
    1. 列出项目所有者、Codex、WorkBuddy、事故止血、数据库迁移、发布六类身份。
    2. 为每类身份列出 CloudRun、Hosting、COS、NoSQL、MySQL、Secret、CLS 的 read/write/delete/deploy 权限。
    3. WorkBuddy 默认无生产 write/delete/deploy；发布角色无生产数据库任意 DML 权限。
    4. 定义权限窗口开始、结束、撤销验证和双人复核字段。
    5. 若当前共享管理员凭据，状态保持 BLOCKED，先完成账号拆分。
  - 禁止：本任务内直接修改 IAM。
  - 验证：矩阵不存在同时拥有“生产 DB 任意写 + 部署 + 删除日志”的单一执行身份。
  - 证据：权限矩阵及脱敏只读查询结果。
  - 停止条件：无法识别实际操作者或权限来源。
  - _需求：PG-R2、PG-R3、PG-R13、PG-R14_

- [x] **A-03 验证 CloudBase MCP 与目标环境绑定**
  - 状态：`REVIEW_COMPLETE`
  - 授权：P0。
  - 前置：A-02 PASS；最终授权人批准生产只读。
  - 允许 pathspec：`evidence/incident-20260802-redacted/mcp-readiness.json`。
  - 步骤：
    1. 执行 MCP 工具列表与 schema 描述；不得猜测参数。
    2. 使用管理侧 auth 检查登录状态。
    3. 显式绑定完整 `EnvId=zy-data-d2g9g1ghr47ac6254`。
    4. 只读回查 environment info，核对 CloudRun 服务和报告环境。
    5. 保存工具版本、schema hash、环境 ID 和时间，不保存临时凭据。
  - 禁止：任何 manage/write/delete/deploy 调用。
  - 验证：只读结果中的 EnvId 完全匹配；别名或默认环境不算通过。
  - 停止条件：MCP 未配置、登录失效、环境不匹配或工具 schema 不明确。
  - _需求：PG-R1、PG-R2、PG-R14_

- [x] **A-04 保全暴露对象、ACL 和访问日志证据**
  - 状态：`REVIEW_COMPLETE`（附 ESC-001 升级事项，待 Codex 裁决）
  - 授权：P0。
  - 前置：A-03 PASS；最终授权人批准生产只读。
  - 允许本地 pathspec：
    - `evidence/incident-20260802-redacted/resource-baseline.json`
    - `evidence/incident-20260802-redacted/object-inventory-summary.json`
    - `evidence/incident-20260802-redacted/access-log-query-summary.json`
  - 步骤：
    1. 查询桶 ACL、对象级 ACL、CDN 和静态托管关系。
    2. 统计敏感前缀对象数量、大小、最早/最晚时间、ETag 和 hash。
    3. 查询 COS/CDN/CLS 日志启用状态和可用时间范围。
    4. 查询 NoSQL `audit_logs`、`submissions` 权限、记录数和敏感字段分类。
    5. 原始证据存加密非 Git 位置；仓库只写脱敏汇总。
  - 禁止：下载完整 PII 到工作区、修改 ACL、删除对象、延长之外的配置写入。
  - 验证：对象计数、时间窗、ACL、日志查询条件都有来源时间和资源摘要。
  - 停止条件：日志即将过期时立即升级给最终授权人决定紧急保全。
  - _需求：PG-R1、PG-R4、PG-R12_

- [x] **A-05 阻断对象存储和 NoSQL 非授权读取**
  - 状态：`REVIEW_COMPLETE / GATE_OK`（2026-08-02；4 次生产写全成功，变更前 3 对象匿名 HTTP 200 实锤 → 变更后 16/16 对象 403；零删除零误伤；残留 U-1 CDN 显式刷新移交所有者）
  - 授权：P1，每个资源动作单独批准。
  - 前置：A-04 PASS；最终授权人批准精确资源列表与可用性影响。
  - 允许本地 pathspec：`evidence/incident-20260802-redacted/containment-change.json`。
  - 平台影响：指定对象/前缀或桶 ACL、指定 NoSQL 集合权限、相关 CDN cache。
  - 步骤：
    1. 记录变更前配置 revision。
    2. 暂停产生新的公开导出对象。
    3. 敏感 NoSQL 集合改为仅服务端/管理员可读。
    4. 按批准策略将敏感对象或桶改私有。
    5. 失效旧 CDN 缓存与长期 URL。
    6. 回读变更后 revision 并记录操作者和时间。
  - 禁止：本任务删除历史对象；禁止改变无关静态资源权限。
  - 验证：无认证独立请求不再返回 200；已授权主链仍按设计可用。
  - 回退：只有误伤合法非敏感公开资源时，按变更前 revision 精确恢复该资源；不得恢复敏感对象公开读。
  - 停止条件：变更目标与 A-04 不一致，或旧 URL 仍返回 200。
  - _需求：PG-R1、PG-R4、PG-R14_

- [x] **A-06 完成止血复核并冻结历史对象删除**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（2026-08-03，Codex F-01 纠偏令第 1 节同步：依据已有证据与安全官独立复核落盘）
  - 授权：P0；删除仍为未授权 P1。
  - 前置：A-05 PASS。
  - 允许 pathspec：`evidence/incident-20260802-redacted/containment-verification.json`。
  - 步骤：
    1. 使用无 Cookie、无 Authorization、独立网络会话复测旧地址。
    2. 复测 NoSQL 客户端匿名/普通用户读取。
    3. 核对 CDN 回源与缓存状态。
    4. 记录合法 API 下载 RBAC 与地市范围结果。
    5. 将历史对象状态标记 `QUARANTINED_PENDING_SCOPE_REVIEW`，不删除。
  - 验证：匿名与越权全部失败，合法授权成功，日志中可关联验证请求。
  - 验收：Codex 签署 `incident-containment.json`；状态仍为 INVESTIGATING。
  - _需求：PG-R1、PG-R4、PG-R11、PG-R12_

## Phase B：可信基线与失败复现

- [x] **B-01 分类当前 250 条工作区变化**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（2026-08-03，Codex F-01 纠偏令第 1 节同步：双口径 251/888 已落盘 `B-01-worktree-dual-metric-addendum.md`）
  - 授权：L0。
  - 前置：A-01 PASS；可与 A-03-A-06 并行但不得修改共享文件。
  - 允许 pathspec：
    - `specs/production-governance-20260802/worktree-classification.md`
    - `evidence/governance/B-01-worktree.json`
  - 步骤：
    1. 分类 tracked modified、deleted、untracked source、generated、backup、database、business data。
    2. 每个文件记录 owner、是否运行时必需、拟纳入哪个任务、是否敏感。
    3. 对备份、分析输出和业务数据只做分类，不删除。
    4. 标记部署候选需要的精确 pathspec 和明确排除项。
  - 禁止：Git 暂存、提交、清理、还原、重命名。
  - 验证：分类总数必须与当次 `git status --porcelain=v1` 行数一致。
  - _需求：PG-R2、PG-R13_

- [x] **B-02 捕获线上 003 与源码五段映射**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（2026-08-03，Codex F-01 纠偏令第 1 节同步：五段判定 S1-S3 VERIFIED / S4 PARTIAL / S5 BROKEN，BASELINE-B02 已冻结）
  - 授权：本地 L1，线上查询 P0。
  - 前置：A-03、B-01 PASS；生产只读批准。
  - 允许 pathspec：
    - `scripts/release/capture-governance-baseline.mjs`
    - `evidence/baselines/*.json`
  - 步骤：
    1. 先写脚本单测，断言不输出 env value。
    2. 实现 commit、porcelain hash、manifest digest、image digest、CloudRun version、hosting release、migration ledger digest 结构。
    3. 线上字段只接受脱敏只读 JSON 输入，不在脚本内持有云凭据。
    4. 无法证明关联时将 003 标记 `KNOWN_BAD_REFERENCE`。
  - 禁止：把当前脏工作区标记 known-good；不得写生产。
  - 验证：同一输入重复生成除时间外稳定 digest；扫描输出无 secret pattern。
  - 证据：`evidence/baselines/<timestamp>.json`。
  - _需求：PG-R2、PG-R3_

- [x] **B-03 建立缺陷回归测试骨架并证明旧代码失败**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（2026-08-03，Codex F-01 纠偏令第 1 节同步：9 测试文件红测完成，P0 全红稳定，BASELINE-B02 六路径 hash 未变）
  - 授权：L1；隔离 MySQL 测试为 I1。
  - 前置：B-01 PASS；隔离资源需要单独批准。
  - 允许 pathspec：
    - `apps/api/test/login-security.test.cjs`
    - `apps/api/test/auth-rate-limit.integration.mjs`
    - `apps/api/test/reporting-import-atomicity.integration.mjs`
    - `apps/api/test/import-job-concurrency.integration.mjs`
    - `apps/api/test/import-job-storage.integration.mjs`
    - `apps/api/test/import-job-list-memory.mjs`
    - `apps/api/test/export-access.integration.mjs`
    - `apps/api/test/security-headers.test.mjs`
    - `apps/api/test/readiness.test.mjs`
  - 步骤：
    1. 每个测试只覆盖一个旧缺陷，不写实现预期之外的架构。
    2. WS6 测试构造首行/中间/末行失败并查询业务表残留。
    3. 并发测试同时确认同一 job。
    4. 列表测试写 10MB Base64 并检查 SQL/heap。
    5. 限流测试连续请求 6 次，记录旧代码无 429。
    6. 容器与托管失败证据在对应任务补充。
  - 禁止：修改业务代码让测试通过；不得连接生产 DB。
  - 验证：每个已确认缺陷至少有一个稳定失败；环境缺失标 BLOCKED 而不是 PASS。
  - 证据：`evidence/regressions/before/*.txt`。
  - _需求：PG-R6、PG-R7、PG-R8、PG-R10、PG-R11_

## Phase C：数据库与认证修复

- [x] **C-01 新增 009 向前迁移与双方言适配**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；不执行生产迁移。
  - 前置：B-03 REVIEW 可接受，B-01 PASS。
  - 允许 pathspec：
    - `apps/api/migration/009_production_governance.sql`
    - `scripts/db/migrate.mjs`
    - `scripts/db/migration-checksums.json`
    - `scripts/test/run-migrations-mysql.mjs`
    - `scripts/test/run-migration-ledger-contract.mjs`
  - 步骤：
    1. 按 design 第 6.1 节新增 import storage/attempt 字段、两个 auth 表和索引。
    2. 添加 SQLite 等价逻辑与 inspectState。
    3. required migration 列表加入 009。
    4. 只新增 009 checksum，验证 001-008 完全不变。
    5. MySQL 测试覆盖空库、重复 up、部分状态拒绝和 ledger 记录。
  - 禁止：修改历史 SQL；自动清空 Base64；添加 down migration。
  - 验证：`node scripts/db/migrate.mjs check-files`；隔离 `pnpm test:migrations:mysql`。
  - 证据：`evidence/governance/C-01-migrations.txt`。
  - 回退：删除未执行的 009 新文件变更；已执行隔离库则销毁隔离 schema，不反向改表。
  - _需求：PG-R5、PG-R6、PG-R8、PG-R11_

- [x] **C-02 安装并锁定安全依赖**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；网络下载需要单独批准。
  - 前置：B-01 PASS。
  - 允许 pathspec：
    - `apps/api/package.json`
    - `apps/admin-web/package.json`
    - `pnpm-lock.yaml`
  - 步骤：
    1. API 加 `@nestjs/throttler@6.5.0`、`helmet@8.3.0`。
    2. API 和 Admin Web 将 xlsx 改为官方 0.20.3 tarball。
    3. API 增加只读 `lint:check`，原有 `lint --fix` 不用于门禁。
    4. 使用 pnpm 命令更新 lockfile，不手改完整性字段。
    5. 运行生产依赖审计；高危项不允许忽略。
  - 禁止：`pnpm audit --fix --force`；无关依赖整体升级。
  - 验证：frozen install、API/Admin build、依赖树只含批准 xlsx 来源。
  - 证据：`evidence/governance/C-02-dependencies.txt`。
  - _需求：PG-R6、PG-R10、PG-R11_

- [x] **C-03 增加生产配置校验、Helmet 和全局 IP 限流**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-02 PASS。
  - 允许 pathspec：
    - `apps/api/src/main.ts`
    - `apps/api/src/runtime.config.ts`
    - `apps/api/src/app.module.ts`
    - `apps/api/.env.example`
    - `scripts/test/check-production-runtime-config.mjs`
    - `apps/api/test/security-headers.test.mjs`
  - 步骤：
    1. 验证设计规定的 proxy、auth、JWT issuer/audience、readiness 环境变量。
    2. `AUTH_SECURITY_HMAC_KEY` 必须与 JWT secret 不同。
    3. 设置可信代理、关闭 x-powered-by、注册 Helmet。
    4. 注册默认 120/min ThrottlerGuard，登录端点后续覆盖 5/min。
    5. 移除 AppModule 新触及分支中的 `as any`，使用精确 TypeORM options。
    6. P0 明确 MaxNum=1；不得声称内存 limiter 支持多实例全局限制。
  - 禁止：CORS 通配符、localhost 生产 origin、打印 secret。
  - 验证：production config 正负测试、tsc、headers 测试、CORS 预检。
  - 证据：`evidence/governance/C-03-runtime-security.txt`。
  - _需求：PG-R5、PG-R6、PG-R9、PG-R10_

- [x] **C-04 实现登录哈希桶和安全事件实体/服务**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-01、C-03 PASS。
  - 允许 pathspec：
    - `apps/api/src/auth/auth-login-rate-limit.entity.ts`
    - `apps/api/src/auth/auth-security-event.entity.ts`
    - `apps/api/src/auth/login-security.service.ts`
    - `apps/api/src/auth/auth.module.ts`
    - `apps/api/test/login-security.test.cjs`
  - 步骤：
    1. 实体逐字段对应 009，不建立 user FK。
    2. HMAC 输入使用 route、NUL 分隔、规范化 subject/IP。
    3. 数据库事务 + pessimistic_write 完成窗口、计数和 block。
    4. 第 5 次失败锁 15 分钟，成功清计数。
    5. 审计事件不写原始 subject/IP/code/token。
    6. 审计写失败返回稳定 503，不能静默成功。
  - 禁止：明文用户名/IP、可逆加密、内存账号锁代替 DB。
  - 验证：单元测试覆盖并发、窗口、HMAC 稳定性和敏感信息扫描。
  - 证据：`evidence/governance/C-04-login-security.txt`。
  - _需求：PG-R5、PG-R6、PG-R12_

- [x] **C-05 接入四个登录端点和强制 JWT 轮换契约**
  - 状态：`REVIEW_COMPLETE`（2026-08-03，Codex 停滞恢复令接管完成；GATE_OK 见台账）
  - 授权：L1；本任务不轮换生产密钥。
  - 前置：C-04 PASS。
  - 允许 pathspec：
    - `apps/api/src/auth/auth.controller.ts`
    - `apps/api/src/auth/auth.service.ts`
    - `apps/api/src/auth/auth.module.ts`
    - `apps/api/src/auth/jwt.strategy.ts`
    - `apps/api/src/auth/jwt.config.ts`
    - `apps/api/src/auth/auth.dto.ts`
    - `packages/shared-types/src/common/auth.dto.ts`
    - `apps/api/test/auth-rate-limit.integration.mjs`
    - `scripts/test/run-auth-v3.mjs`
  - 步骤：
    1. 本地 class DTO 实现 shared interface 并加长度验证。
    2. 四个 Public 端点加 5/min throttle。
    3. 控制器传可信 req.ip/requestId。
    4. 密码登录采用 dummy bcrypt、统一 401、内部 reason code。
    5. 微信 code 和邀请 token 只在内存，审计只写 HMAC。
    6. JWT 签发/验证加 issuer/audience，不增加旧密钥验证。
    7. 保留 authVersion 账号级撤销。
  - 禁止：根据用户是否存在返回不同文案；记录 password/code/openid。
  - 验证：连续失败 429、账号桶锁定、未知账号等时响应、成功/失败审计、旧 JWT secret 测试失效。
  - 证据：`evidence/governance/C-05-auth-integration.txt`。
  - _需求：PG-R5、PG-R6、PG-R11_

## Phase D：WS6 数据完整性与存储

- [x] **D-01 统一上传过滤并切换新任务到持久存储**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-01 PASS；B-03 已有 storage 失败测试。
  - 允许 pathspec：
    - `apps/api/src/ws6/import-upload.config.ts`
    - `apps/api/src/ws6/admin-import-jobs.controller.ts`
    - `apps/api/src/ws6/admin-imports.controller.ts`
    - `apps/api/src/ws6/city-import-jobs.controller.ts`
    - `apps/api/src/ws6/city-imports.controller.ts`
    - `apps/api/src/ws6/import-job.entity.ts`
    - `apps/api/src/ws6/ws6.module.ts`
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/src/facts/facts.module.ts`
    - `apps/api/test/import-job-storage.integration.mjs`
  - 步骤：
    1. 新建唯一 Multer options：10MB、1 file、xlsx/xls/csv 扩展名。
    2. 四控制器传 Buffer，不再转 Base64。
    3. entity 加 009 字段，Base64 `select:false`。
    4. Ws6Module 导入 FactsModule，注入已有 storage service。
    5. create job：hash -> store -> metadata -> DB；失败不创建有效 job。
    6. read source：storage+hash 优先，legacy query 显式 addSelect 回退。
  - 禁止：新存储抽象、公开 URL、清空旧 Base64。
  - 验证：新任务 DB 无 Base64、有 metadata；重启后 hash 下载一致；legacy 可读。
  - 证据：`evidence/governance/D-01-import-storage.txt`。
  - _需求：PG-R4、PG-R8、PG-R10_

- [x] **D-02 修复列表大字段读取和地市任务归属校验**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：D-01 PASS。
  - 允许 pathspec：
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/src/common/security/scope.ts`
    - `apps/api/test/city-import-access.test.mjs`
    - `apps/api/test/import-job-list-memory.mjs`
  - 步骤：
    1. list query 显式 select 设计列。
    2. `assertImportJobAccess` 对非管理员调用 `assertCityImportAccess`。
    3. detail/preview/confirm/cancel/download 共用同一访问入口。
    4. 同地市他人 operator 返回 403。
    5. 10MB legacy Base64 + pageSize100 堆增长小于 20MB。
  - 禁止：放宽管理员之外的 operator 检查；详情返回 Base64。
  - 验证：SQL 不含 source_file_base64，权限矩阵正反测试通过。
  - 证据：`evidence/governance/D-02-list-access.txt`。
  - _需求：PG-R7、PG-R8、PG-R11_

- [x] **D-03 使 reporting/contract 导入发生任一错误即全批回滚**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：B-03 的原子性旧失败证据、D-01 PASS。
  - 允许 pathspec：
    - `apps/api/src/ws6/reporting-import.service.ts`
    - `apps/api/src/ws6/contract-import.service.ts`
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/test/reporting-import-atomicity.integration.mjs`
  - 步骤：
    1. 新增带 readonly errors 的 AtomicityError。
    2. transaction callback 结束前 errors 非空必须 throw。
    3. contract 分支检索相同模式并统一语义。
    4. Ws6Service 在事务外保存 FAILED/error summary/failureCode。
    5. successCount 不得在回滚后作为已写入数量对外返回。
  - 禁止：catch 后 continue 提交；吞掉数据库异常。
  - 验证：首/中/末行、DB 异常后所有相关业务表零增量；job FAILED 有摘要。
  - 证据：`evidence/governance/D-03-atomicity.txt`。
  - _需求：PG-R7、PG-R11_

- [x] **D-04 增加原子认领、并发互斥和受控重试**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：D-03 PASS。
  - 允许 pathspec：
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/src/ws6/ws6.dto.ts`
    - `apps/api/src/ws6/admin-import-jobs.controller.ts`
    - `apps/api/src/ws6/city-import-jobs.controller.ts`
    - `packages/shared-types/src/common/misc.dto.ts`
    - `apps/api/test/import-job-concurrency.integration.mjs`
  - 步骤：
    1. preview/overwrite 检查后原子 PENDING|PREVIEWED -> PROCESSING。
    2. affected=0 时区分 completed/processing/invalid 状态。
    3. 成功 COMPLETED，失败 FAILED，并保留 attempt/failureCode。
    4. 新增 admin/city retry 端点。
    5. retry 只允许 storage metadata 完整、白名单 failureCode、attempt<3。
    6. legacy FAILED 无 storage key 返回 LEGACY_REVIEW_REQUIRED。
  - 禁止：长事务包住 Excel 解析；FAILED 任意无限重试。
  - 验证：20 个并发 confirm 最多一个执行；retry 状态转换和审计正确。
  - 证据：`evidence/governance/D-04-concurrency-retry.txt`。
  - _需求：PG-R7、PG-R11_

- [x] **D-05 集中工作簿策略并限制解析资源**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-02 PASS。
  - 允许 pathspec：
    - `apps/api/src/common/files/workbook-policy.ts`
    - `apps/api/src/ws6/reporting-import.service.ts`
    - `apps/api/src/ws6/contract-import.service.ts`
    - `apps/api/src/facts/fact-import.service.ts`
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/test/workbook-policy.test.cjs`
  - 步骤：
    1. 封装所有 XLSX.read 调用。
    2. 限制 10MB、20 sheets、每表 100k rows、200 columns。
    3. 解析后立即按 !ref 校验，越限返回稳定 400。
    4. 同步导出超过 100k 行拒绝生成。
    5. 扫描仓库确认运行时代码无直接 XLSX.read。
  - 禁止：仅靠 MIME；catch 解析错误后继续。
  - 验证：正常、超大小、超 sheet、超行列、畸形文件测试。
  - 证据：`evidence/governance/D-05-workbook-policy.txt`。
  - _需求：PG-R10、PG-R11_

- [x] **D-06 编写旧 Base64 文件迁移工具（仅 dry-run）**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；隔离 apply 为 I1，生产 apply 为 P1。
  - 前置：D-01 PASS。
  - 允许 pathspec：
    - `scripts/oneoff/migrate-import-job-files.mjs`
    - `scripts/test/migrate-import-job-files.test.mjs`
    - `docs/import-job-file-migration-runbook.md`
  - 步骤：
    1. 默认 dry-run，缺少 `--apply --env-id` 硬失败写入。
    2. ID 游标、batch=20、hash 校验、metadata 更新。
    3. 幂等跳过已迁移且 hash 一致任务。
    4. 失败保留 Base64，输出脱敏 job ID/错误码。
    5. 不实现清空 Base64 功能。
  - 禁止：OFFSET 全表扫描、生产默认连接、原始 Base64 日志。
  - 验证：隔离数据 dry-run/apply/re-run、故障注入和 hash 不一致。
  - 证据：`evidence/governance/D-06-file-migration.txt`。
  - _需求：PG-R8、PG-R11、PG-R14_

## Phase E：导出、健康、日志、前端与容器

- [x] **E-01 强化鉴权流式导出和下载审计**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：D-02 PASS。
  - 允许 pathspec：
    - `apps/api/src/ws6/exports.controller.ts`
    - `apps/api/src/ws6/ws6.service.ts`
    - `apps/api/src/ws6/export-job.entity.ts`
    - `apps/api/test/export-access.integration.mjs`
    - `scripts/test/run-auth-v3.mjs`
  - 步骤：
    1. 下载要求 COMPLETED、未过期、operator/role/city scope。
    2. 设置 private/no-store 和 attachment。
    3. success/denied/expired/failed 全部审计。
    4. fileUrl 只返回相对鉴权 API 路径。
    5. 扫描无 COS 公网 export 写入代码。
  - 禁止：长期签名 URL、公开桶、客户端 scopeLabel 作为授权依据。
  - 验证：五类访问测试及缓存头；公开对象扫描为零。
  - 证据：`evidence/governance/E-01-export-security.txt`。
  - _需求：PG-R4、PG-R11、PG-R12_

- [x] **E-02 将 readiness 改为有超时、缓存的只读探针**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-03 PASS。
  - 允许 pathspec：
    - `apps/api/src/facts/fact-source-file-storage.service.ts`
    - `apps/api/src/app.service.ts`
    - `apps/api/src/app.controller.ts`
    - `apps/api/test/readiness.test.mjs`
  - 步骤：
    1. storage 拆 assertReadable/assertWritable。
    2. module init 执行一次写探针；ready 只读。
    3. DB/storage 各 2 秒超时，结果缓存 5 秒。
    4. 空 catch 改稳定 dependency code，不泄露连接信息。
    5. Node error 用 unknown type guard，移除相关 any。
  - 禁止：ready 每次创建文件；ready 永久缓存成功。
  - 验证：并发 100 次 ready 只触发受控依赖检查；失败返回 503。
  - 证据：`evidence/governance/E-02-readiness.txt`。
  - _需求：PG-R10、PG-R12_

- [x] **E-03 增加 request ID 和脱敏结构化 HTTP 日志**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1。
  - 前置：C-03 PASS。
  - 允许 pathspec：
    - `apps/api/src/common/http/request-id.middleware.ts`
    - `apps/api/src/common/http/http-logging.interceptor.ts`
    - `apps/api/src/app.module.ts`
    - `apps/api/test/http-logging.test.mjs`
  - 步骤：
    1. 验证/生成最大 64 字符 request ID。
    2. 响应回传 X-Request-Id。
    3. 日志字段限定 method、route、status、duration、requestId、userId、cityId。
    4. 测试 body/header/query/openid/name/password 不出日志。
  - 禁止：记录 Authorization、Cookie、body、完整 query。
  - 验证：敏感词和伪 token 扫描为零，异常也有 request ID。
  - 证据：`evidence/governance/E-03-http-logging.txt`。
  - _需求：PG-R6、PG-R12_

- [x] **E-04 构建可复现的 `/dataofearth/` Hosting bundle**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；不发布 Hosting。
  - 前置：C-02 PASS、B-01 PASS。
  - 允许 pathspec：
    - `apps/admin-web/vite.config.ts`
    - `scripts/release/build-hosting-bundle.mjs`
    - `scripts/test/check-hosting-bundle.mjs`
    - `package.json`
  - 步骤：
    1. 保留 HashRouter 和 base `/dataofearth/`。
    2. 构建后断言 asset 路径前缀。
    3. 生成根 meta refresh/JS fallback 和 dataofearth 完整内容。
    4. 计算 bundle digest，禁止直接部署 dist 到根。
  - 禁止：改 BrowserRouter、UI 重设计、硬编码新 API 密钥。
  - 验证：本地静态服务器根与子目录均非 500，资源全部 200。
  - 证据：`evidence/governance/E-04-hosting-bundle.txt`。
  - _需求：PG-R9、PG-R11_

- [x] **E-05 建立正式 Playwright 路由与认证回归**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；隔离后端为 I1。
  - 前置：E-04 PASS。
  - 允许 pathspec：
    - `playwright.config.ts`
    - `apps/admin-web/e2e/hosting-routes.spec.ts`
    - `package.json`
  - 步骤：
    1. 覆盖根跳转、dataofearth、三类 hash 深链和刷新。
    2. 捕获 console error、pageerror、failed request。
    3. 覆盖未登录 redirect、登录恢复、JWT 401 清 token。
    4. CORS 正式 origin 成功，随机和 localhost 失败。
    5. 证据含截图、trace、网络摘要，不含 token。
  - 禁止：使用生产账号/数据作为自动化 fixture。
  - 验证：桌面和移动视口核心路径通过；页面/文本无重叠。
  - 证据：`evidence/governance/E-05-browser.json` 与 Playwright artifacts。
  - _需求：PG-R9、PG-R11_

- [x] **E-06 改造非 root 容器并验证持久挂载权限**
  - 状态：`REVIEW_COMPLETE`（2026-08-03；GATE_OK 见台账）
  - 授权：L1；真实隔离挂载为 I1。
  - 前置：E-02 PASS。
  - 允许 pathspec：
    - `Dockerfile`
    - `apps/api/Dockerfile`
    - `.dockerignore`
    - `scripts/test/check-container-runtime.mjs`
  - 步骤：
    1. 确定唯一权威 Dockerfile；副本必须一致或删除引用后移除。
    2. runner 创建 UID/GID 10001，COPY --chown，USER 10001。
    3. 保留 PORT、live healthcheck、持久路径标签。
    4. 构建镜像并检查 UID、监听、只读/可写路径。
    5. 隔离挂载覆盖后验证 10001 可读写；失败不能退回 root。
  - 禁止：privileged、chmod 777、root entrypoint 后降权替代。
  - 验证：container test、live/ready、重启后文件 hash。
  - 证据：`evidence/governance/E-06-container.json`。
  - _需求：PG-R8、PG-R10、PG-R11_

## Phase F：发布门禁与完整验收

- [x] **F-01 强化发布 manifest、integrity 与证据绑定**
  - 状态：`PASS_WITH_EXPECTED_DIRTY_BLOCK`（**Codex F-01 验收裁定，2026-08-03**：独立复验通过——共享类型与 API 类型检查全通过、测试 11/0/0、4/0/0、5/0/0、治理与证据门禁 exit 0、完整性门禁原始退出码 2；PASS 仅表示门禁能正确识别并拒绝脏候选，**不代表发布候选可用、不代表项目 GO**；release-integrity --gate 必须保持阻断直至 F-06 干净候选）
  - 授权：L1。
  - 前置：C-E 代码任务全部 PASS。
  - 允许 pathspec：
    - `specs/rbac-auth-export-settings/release-manifest.json`
    - `scripts/release/check-release-integrity.mjs`
    - `scripts/release/check-platform-completeness.mjs`
    - `scripts/release/check-governance-gates.mjs`
    - `scripts/test/check-governance-evidence.mjs`
    - `package.json`
  - 步骤：
    1. manifest 纳入本治理全部运行时、测试、迁移、发布文件。
    2. gate 报告 modified/deleted/untracked/missing/checksum。
    3. evidence schema 强制绑定 commit 和 manifest digest。
    4. 缺证据退出 2，内容失败退出 1，全部通过退出 0。
    5. 不把原始事故证据、备份、数据库和 analysis-output 纳入。
  - 禁止：仅靠 tasks checkbox 判 PASS；伪造 isolated evidence。
  - 验证：篡改 commit/digest、删证据、脏文件均能硬阻断。
  - 证据：`evidence/governance/F-01-release-gates.txt`。
  - _需求：PG-R2、PG-R3、PG-R11、PG-R13_

- [x] **F-02 对齐 CloudRun 服务名和部署文档（不部署）**
  - 状态：`PASS`（**Codex F-02 独立复验裁定，2026-08-03**：18 项纯函数参数断言通过、runGates 第 19 项准确阻断在 release-integrity exit 2、完整 SHA/短 SHA/EnvId/服务名/绝对 source/灰度参数均符合要求、governance/evidence gates exit 0、DEV-005 越界变更登记完整、未调用 tcb 未产生线上写入。**F-02 PASS 不代表发布候选可用或项目 GO，当前完整性阻断继续有效**）
  - 授权：L1。
  - 前置：B-02 PASS、F-01 PASS（均满足）。
  - 允许 pathspec：
    - `cloudbaserc.json`
    - `apps/api/cloudbaserc.json`
    - `scripts/deploy.js`
    - `README.md`
    - `docs/deployment-guide.md`
    - `docs/deployment-incident-runbook.md`
  - 步骤：
    1. staging 名称统一 `biz-reporting-api-v3-staging`。
    2. 所有命令显式完整 EnvId 和 target；不得依赖 CLI current env。
    3. 移除/禁用绕过门禁的交互式 deploy 入口。
    4. 文档写明 Container mode、MinNum>=1、P0 MaxNum=1、health 路径。
    5. 生产配置独立，不能字符串替换 staging 后直接使用。
  - 禁止：调用 deploy、更新线上服务。
  - 验证：全仓服务名扫描无漂移；deploy script 在 gate 非 PASS 时退出。
  - 证据：`evidence/governance/F-02-deploy-config.txt`。
  - _需求：PG-R2、PG-R3、PG-R10_

- [x] **F-03 执行完整本地静态与单元门禁**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（2026-08-03，Codex PG-20260803-EXEC-TO-FULL-REVIEW 连续执行令：ESLint 专项完成后内部收口，最终 PASS 由 Codex 统一裁定。**阻塞三并列已全部处置**：①ESLint 配置缺失→专项完成（API lint:check exit 0 + Admin lint exit 0）②preflight TRUST_PROXY_HOPS 漏项→F-03-CORR-PREFLIGHT 修复 exit 0 ③5 项 I1 测试→DEV-006 重分类转 F-04。release-integrity exit 2 仅登记 EXPECTED_DIRTY_BLOCK，F-06 前保持）
  - 授权：L0/L1，仅产生构建输出。
  - 前置：F-01、F-02 PASS。
  - 允许 pathspec：只写临时 build/test/evidence 输出，不修改源码。
  - 必跑：
    1. shared types typecheck/build。
    2. API tsc、lint:check、build。
    3. Admin Web tsc、lint、build。
    4. `node --test apps/api/test`。
    5. migration check、architecture、deployment preflight。
    6. release integrity 与 governance gates。
  - 禁止：自动 fix、更新 snapshot、跳过测试。
  - 验证：全部 exit 0；外部证据缺失允许 gate exit 2，但任务状态为 BLOCKED，不是 PASS。
  - 证据：`evidence/governance/F-03-local-gates.txt`、`evidence/governance/F-03-correction-report.txt`。
  - _需求：PG-R11_
  - 首轮执行结果（2026-08-03，Gu 依 Codex F-02 PASS 放行令执行）：exit 0 通过项 = shared-types typecheck/build、API typecheck/v3-check/build、Admin tsc/build、migration check-files(10)、migration ledger(10)、architecture(0 违规)、check-production-runtime-config、governance gates(17)、evidence gate(29 绑定)；**真实阻塞** = API lint:check exit 2 + Admin lint exit 2（全仓无 ESLint 配置，预存在缺口，C-02 已登记）+ run-deployment-preflight exit 1（validProduction 缺 C-03 新增 TRUST_PROXY_HOPS 字段，工具脚本滞后）；**环境依赖失败** = node --test 72 项中 5 项 fail（dual-chain-verify/facts-v31/import-production-loop/real-write-verify/v3-fact-lifecycle，均 I1 隔离令牌/DB/参数前置检查）；**预期阻断** = release-integrity --gate exit 2（EXPECTED_DIRTY_BLOCK，F-06 前保持）。首轮自报 BLOCKED_EXPECTED_DIRTY_CANDIDATE 被 Codex 裁定不通过（不得以预存在缺口当通过理由）。
  - 纠偏执行完毕（PG-20260803-F03-CORR，2026-08-03 15:30）：①**F-03-CORR-PREFLIGHT** 唯一授权源码修改 run-deployment-preflight.mjs（validProduction 补 TRUST_PROXY_HOPS:'1'+其余 C-03 必填+E-02 语义对齐 down→dependency_error/assertReady→assertReadable），exit 0，未触碰 runtime.config.ts/app.service.ts/生产配置/凭据；②canonical digest 重算 9a073b85→**3290dcbc**（24 份证据绑定更新）；③**ESLint=BLOCKED_NEEDS_NETWORK_AUTH**（eslint@9.39.4 存在但 @typescript-eslint/parser+plugin 完全缺失，禁止自行联网安装）；④**5 项 I1 测试=BLOCKED_I1 转 F-04**（DEV-006）；⑤复跑全门禁：gates 0 / evidence 0（31 绑定）/ integrity 2（EXPECTED_DIRTY_BLOCK）。DEV-006 已登记。
  - **ESLint 专项完成（PG-20260803-EXEC-TO-FULL-REVIEW 第二节，2026-08-03 15:55）**：corepack pnpm 9.15.0 安装 eslint@9.39.4+typescript-eslint@8.65.0；eslint.config.mjs flat config（recommended 基线）；API lint:check exit 0 + Admin lint exit 0（共 40 errors+57 warnings 清零，行为保持型修复，清单见 DEV-007）；canonical digest 重算 3290dcbc→**246eddf8**（25 份证据绑定更新）；复跑全门禁 gates 0 / evidence 0（31 绑定 digest=246eddf8）/ integrity 2（EXPECTED_DIRTY_BLOCK）；node --test 72 项 67 pass/5 fail（I1 前置）/0 skip；preflight 0。F-03 收口 **REVIEW_COMPLETE / GATE_OK**，立即进入 F-04。

- [x] **F-04 隔离 MySQL、存储和迁移全链验收**
  - 状态：`BLOCKED_I1`（2026-08-03 评估：隔离 API/MySQL/存储/token/TEST_DB/fixture/output 前置全缺失，不得 PASS，详见 F-04-isolated-env.txt；**DEV-006 重分类：承接 F-03 5 项 I1 测试——dual-chain-verify / facts-v31.integration / import-production-loop / real-write-verify / v3-fact-lifecycle，全部转入 F-04 隔离后端/数据库/存储终验**；缺失任一前置条件标记 BLOCKED_I1，不得标记 PASS）
  - 授权：I1。
  - 前置：F-03 PASS；最终授权人批准明确隔离资源。
  - 允许 pathspec：evidence only。
  - 步骤：
    1. 核对隔离标识、非 root 凭据和空 schema。
    2. `precheck -> up -> status -> up -> status`。
    3. 运行 auth、WS6 atomicity/concurrency、storage、export 集成测试。
    4. 上传测试文件，重启和实例重建后核 hash。
    5. 数据库与文件联合备份并恢复到新隔离资源。
    6. **（DEV-006）为 5 项转入测试提供**：隔离 API 实例 / 隔离数据库副本 / 隔离存储根目录 / 所需 token、TEST_DB、fixture 和 output 参数 / 执行前后资源摘要、hash、恢复验证和脱敏证据。
  - 禁止：DB_* 回退、生产/共享目标、修改 001-008。
  - 验证：ledger/checksum、行数、金额、job 状态、文件 hash、审计一致。
  - 证据：`evidence/deployment-gates/mysql.json`、`storage.json`。
  - _需求：PG-R3、PG-R7、PG-R8、PG-R11_

- [x] **F-05 隔离浏览器、路由、RBAC 和导出验收**
  - 状态：`BLOCKED_I1`（2026-08-03 评估：隔离 API/Hosting 部署、四角色账号、隔离数据缺失，不得 PASS，详见 F-05-isolated-browser.txt；**DEV-006 收窄：仅执行浏览器、路由、RBAC、导出和 Playwright 验收；F-03 的 5 项 I1 测试已全部转 F-04，不转入 F-05**）
  - 授权：I1。
  - 前置：E-05、F-04 PASS。
  - 允许 pathspec：evidence and Playwright artifacts only。
  - 步骤：
    1. 部署到隔离 API/Hosting，不使用生产域名和数据。
    2. 四角色登录、强制改密、旧 JWT 失效。
    3. 根站、hash 深链、刷新、前后导航、CORS。
    4. 地市上传、预览、确认、失败、重试、跨用户拒绝。
    5. 导出行数/金额/范围与审计核对。
  - 禁止：修改测试失败页面以绕过业务验证；使用生产账号。
  - 验证：Playwright 全绿、无 console/page/network error、截图布局正常。
  - 证据：`evidence/deployment-gates/browser.json`。
  - _需求：PG-R4、PG-R6、PG-R7、PG-R9、PG-R11_

- [x] **F-06 生成干净发布候选提交方案**
  - 状态：`REVIEW_COMPLETE` / `GATE_OK`（方案，2026-08-03：release-candidate-pathspec/exclusions/rc-plan 已生成；git add/commit 未执行需最终授权人批准）
  - 授权：L0；Git 暂存/提交仍需最终授权人批准。
  - 前置：B-01、F-03-F-05 PASS。
  - 允许 pathspec：
    - `specs/production-governance-20260802/release-candidate-pathspec.txt`
    - `specs/production-governance-20260802/release-candidate-exclusions.txt`
    - `evidence/governance/F-06-rc-plan.json`
  - 步骤：
    1. 从 B-01 分类和 release manifest 生成精确 include/exclude。
    2. 列出每个候选文件对应 task 和 requirement。
    3. 验证无业务数据、备份、sqlite、analysis-output、secret。
    4. 模拟 digest，不执行 git add/commit。
  - 禁止：广泛 pathspec、自动提交、清理用户文件。
  - 验证：候选文件全部已通过对应门禁；排除项数量与工作区一致。
  - _需求：PG-R2、PG-R3、PG-R13_

## Phase G：生产变更、灰度和收口

- [x] **G-01 生产变更前最终安全与回滚评审**
  - 状态：`BLOCKED`（2026-08-03 P0 只读回读完成：唯一版本 003、无 known-good 备选版本、ESC-003 明文凭据未处置、止血未回退；GO_TO_DEPLOY 前置不满足）
  - 授权：P0；后续动作均未授权。
  - 前置：所有 A-F 任务 PASS，F-06 的 Git 操作另行获批并形成 commit。
  - 交付：维护窗口表、五段映射、镜像/hosting digest、联合恢复点、旧版本、回切命令、责任人、阈值。
  - 步骤：
    1. 回读 CloudRun、Hosting、DB、storage、secret、CLS 当前状态。
    2. 复核 incident containment 未回退。
    3. 确认至少一个真实 known-good 旧应用版本；003 不算 known-good。
    4. 检查发布身份和回切身份可用。
    5. Codex 给出 GO_TO_DEPLOY 或 BLOCKED；最终授权人决定。
  - _需求：PG-R1、PG-R2、PG-R3、PG-R12、PG-R14_

- [x] **G-02 执行 009 生产迁移**
  - 状态：`BLOCKED`（2026-08-03：前置 G-01 GO_TO_DEPLOY+联合备份不满足；未执行任何迁移）
  - 授权：P1，单独批准迁移窗口、目标 schema 和 SQL digest。
  - 前置：G-01 GO_TO_DEPLOY、联合备份完成。
  - 步骤：只执行批准 commit 的迁移器 `precheck -> up -> status -> up -> status`。
  - 禁止：手工改表、down migration、默认 schema、root 用户。
  - 验证：009 state satisfied、ledger checksum、旧表数据不变、应用旧版本仍可启动。
  - 停止条件：partial state、checksum 漂移、锁等待超阈值、备份不可恢复。
  - 证据：`evidence/production/G-02-migration-redacted.json`。
  - _需求：PG-R3、PG-R5、PG-R8、PG-R14_

- [x] **G-03 轮换 DB 密码和 JWT secret**
  - 状态：`BLOCKED`（2026-08-03：前置 G-02 不满足；ESC-003 明文 EnvParams 未迁出前禁止轮换）
  - 授权：P1，DB 与 JWT 两个动作分别批准。
  - 前置：G-02 PASS；新版本已无流量部署并验证新 secret。
  - 步骤：
    1. 创建新 DB 密码和 JWT secret，注入无流量版本。
    2. 新版本登录、RBAC、readiness 验证。
    3. 切流后确认旧 JWT 全部 401，前端要求重新登录。
    4. 撤销旧 DB 密码，检查连接池已重建。
    5. 删除旧 secret 部署引用，不删除审计记录。
  - 禁止：在日志/文档显示值；保留旧 JWT 验证路径。
  - 回退：流量回切旧版本前必须评估旧版本所需旧 DB 凭据；不得重新公开旧 JWT secret。
  - 证据：只保存 secret version/id 摘要和验证状态。
  - _需求：PG-R5、PG-R6、PG-R14_

- [x] **G-04 无流量部署 API、Hosting 并完成回切演练**
  - 状态：`BLOCKED`（2026-08-03：前置 G-01+F-06 候选提交不满足；无 known-good 回切目标；未部署）
  - 授权：P1，CloudRun deploy 与 Hosting publish 分别批准。
  - 前置：G-01 PASS；G-02/G-03 顺序由维护窗口批准方案确定。
  - 步骤：
    1. 使用 MCP 并显式 EnvId/服务名部署候选，流量 0%。
    2. 验证 port、live、ready、UID、mount、headers、config revision。
    3. 发布已验 digest 的 Hosting bundle，回读 website config。
    4. 内部地址完成核心冒烟。
    5. 切到候选再回旧版本演练；导入保持暂停。
  - 禁止：覆盖唯一旧版本、绕过 gate、删除 003、自动扩流。
  - 验证：新旧均可运行；回切时间在预算内；数据兼容判断成立。
  - 证据：`evidence/deployment-gates/rollback.json`、`container.json`。
  - _需求：PG-R3、PG-R9、PG-R10、PG-R11_

- [x] **G-05 灰度 5% -> 25% -> 50% -> 100%**
  - 状态：`BLOCKED`（2026-08-03：前置 G-04 不满足；未灰度）
  - 授权：P1，每个扩流阶段需要 Codex PASS；首次和 100% 需最终授权人确认。
  - 前置：G-04 PASS。
  - 观察：5% 15 分钟、25% 30 分钟、50% 30 分钟、100% 60 分钟。
  - 每阶段检查：5xx、P95/P99、内存、429、登录失败、DB 连接、导入、存储、审计。
  - 停止/回切：5xx>1%、P95>1500ms、内存>85%、任一 hash/atomicity/audit 错误或业务对账差异。
  - 禁止：观察时间不足继续扩流；平台不支持比例时伪造灰度。
  - 证据：`evidence/production/G-05-canary-redacted.json`。
  - _需求：PG-R3、PG-R12、PG-R14_

- [x] **G-06 旧 Base64 生产迁移与历史对象处置评审**
  - 状态：`BLOCKED`（2026-08-03：前置 G-05 不满足；dry-run 工具就绪，apply 与删除严禁）
  - 授权：dry-run P0；apply 与历史对象删除分别为 P1。
  - 前置：G-05 PASS，观察期无 storage 错误。
  - 步骤：
    1. 生产 dry-run，核任务数、预计字节、冲突和失败。
    2. 最终授权后小批 apply，每批核 hash 和 metadata。
    3. 观察期内保留 Base64，不清空。
    4. 事故历史对象根据日志范围和隐私/法务决定隔离保留或删除。
    5. 删除动作必须有对象清单 hash、备份/保全结论和单独批准。
  - 禁止：自动全量清空、边迁移边删除、无日志范围时销毁证据。
  - 证据：`evidence/production/G-06-data-governance-redacted.json`。
  - _需求：PG-R1、PG-R8、PG-R14_

- [x] **G-07 治理验收、NO_GO 解锁或继续 BLOCKED**
  - 状态：`FULL_REVIEW`（2026-08-03 交付 final-governance-report-20260802.md；整体 NO_GO 建议，GO/NO_GO 由 Codex 统一裁定）
  - 授权：L1/P0 只读汇总。
  - 前置：G-05 PASS；G-06 可保持后续治理但不得有公开风险。
  - 允许 pathspec：
    - `specs/production-governance-20260802/validation-report.md`
    - `README.md`
    - `docs/deployment-guide.md`
  - 步骤：
    1. 对 14 项需求、全部任务、11 项发布硬门禁逐条映射证据。
    2. 列出未关闭风险、风险所有者、截止时间和是否阻塞。
    3. Codex 给出 `GO`、`CONDITIONAL_GO` 或 `BLOCKED`，不能由健康分替代硬门禁。
    4. 最终授权人签署发布结论。
    5. 撤销临时 IAM，保留证据和监控。
  - 禁止：有未关闭 P0/P1 时签 GO；删除失败证据。
  - 验证：需求、设计、task、commit、image、hosting、migration、evidence 全链可追溯。
  - _需求：PG-R1-PG-R14_

## 1. 依赖顺序总表

```text
A-01 -> A-02 -> A-03 -> A-04 -> A-05 -> A-06
  |
  +-> B-01 -> B-02
       |
       +-> B-03
            |
            +-> C-01 -> C-04 -> C-05
            +-> C-02 -> C-03 -> E-02/E-03
            +-> D-01 -> D-02 -> D-03 -> D-04
            +-> C-02 -> D-05
            +-> D-01 -> D-06
            +-> D-02 -> E-01
            +-> C-02 -> E-04 -> E-05
            +-> E-02 -> E-06

C/D/E all PASS -> F-01 -> F-02 -> F-03 -> F-04 -> F-05 -> F-06
F all PASS -> G-01 -> G-02/G-03/G-04 approved sequence -> G-05 -> G-06 -> G-07
```

虽然图中存在可并行分支，WorkBuddy 不得并行修改共享文件；Codex 每次只开放一个会触碰共享文件的任务。

## 2. 任务计划确认门

批准本任务计划表示：

1. 授权 Codex 在任务计划范围内逐项开放 L0/L1 工作给 WorkBuddy。
2. 不授权任何 I1/P0/P1 动作；这些仍逐项确认。
3. WorkBuddy 必须按依赖顺序执行，不能扩大 pathspec 或改变设计。
4. Codex 可因证据失败将任一任务置为 BLOCKED。
5. 生产发布结论在 G-07 前始终保持 `NO_GO`。

计划批准后，从 A-01 开始；在获得新的明确指令前，Codex 不自行替代 WorkBuddy 执行业务代码治理。

