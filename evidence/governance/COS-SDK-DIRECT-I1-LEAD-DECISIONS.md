# COS SDK 直连 I1 — 主理人裁决与阻塞登记

本文件由交付主理人维护，记录本轮执行中**由主理人做出的裁决**、**必须由上游（Codex）拍板的阻塞项**，以及**制度性冲突的登记（只登记、不擅改 specs）**。

- 工作区：`E:/code2/biz-reporting-system-recovery`（旧工作区 `E:/code2/biz-reporting-system-fix` 已冻结）
- 分支：`fix/i1-typeorm-migration-storage`
- 记录时 HEAD：`17bf683a66d1b137a547cb21de9c70323f35cf5e`（docs: freeze COS SDK direct storage architecture）
- 保留链：`60f3a48`（恢复 checkpoint）→ `286d338`（TypeORM 迁移修复，**必须保留**）→ `17bf683`
- 隔离环境：`zy-data-d2g9g1ghr47ac6254`（生产环境全程零指令）

---

## 一、执行前基线（已实测，非推断）

| 项 | 实测值 | 判定 |
|---|---|---|
| HEAD（执行前） | `286d338bc1f996ef0c1af2d2c47b8b3199d2fa21` | 符合，未丢失 TypeORM 迁移修复 |
| 分支 | `fix/i1-typeorm-migration-storage` | 符合 |
| `60f3a48` 是否为 HEAD 祖先 | `ANCESTOR_OK=true` | 符合 |
| `286d338` 是否为 HEAD 祖先 | `RETAINS_286d338=true` | 符合 |
| remote | `Juzongtong813/biz-reporting-system` | 符合 |
| 既有治理产物 | `cloudbaserc.json` + `evidence/` + `workspace-recovery-*` ×7 | 与交底清单一致，原样保留 |

未触发 BLOCKED 条件，未执行任何 reset / checkout -- / force push / 切分支。

原始基线证据：`evidence/governance/COS-SDK-DIRECT-I1-BASELINE-PRE.txt`

### 结构性事实（必须上游知悉）

**恢复工作区是旧工作区的 git worktree。** `.git` 为文件而非目录，内容指向 `E:/code2/biz-reporting-system-fix/.git/worktrees/...`，`git rev-parse --git-common-dir` 指向旧工作区。两区**共享同一对象库与 refs**——恢复区每次 commit 都会写入旧工作区的 `.git`。

- 旧工作区**工作树**（master / `bad2a7d`）不受影响，未被读取后写入、未切分支、未清理。
- `286d338` 本身即在此结构下产生，属**既有安排**，非本轮引入。
- 主理人按「工作树冻结、共享对象库不可避免」继续执行。若上游判定不可接受，需立即叫停。

**`cloudbaserc.json` 的 ` M` 是假修改**：`git diff -- cloudbaserc.json` 输出为空，仅 LF/CRLF 行尾差异，内容未变。未对其做任何写操作。

---

## 二、主理人裁决（PM 与架构师产出直接对撞的四处）

来源冲突：
- PM 报告：`evidence/governance/COS-SDK-DIRECT-I1-REQUIREMENTS-ALIGNMENT.md`（CONFLICT 11 / ADAPT 30 / KEEP 20，5 个 ACL 缺口，13 个待拍板问题）
- 架构师设计：`specs/production-governance-20260802/design-cos-sdk-direct-storage.md` + `tasks-cos-sdk-direct-storage.md`

### D-1：撤销 `FACT_SOURCE_STORAGE` 注入符号 —— 采纳 PM

- **冲突**：架构师设计新增 `interface FactSourceStorage` + `const FACT_SOURCE_STORAGE = Symbol(...)`；PM 指出 specs `DES-05` / `DES-20` 与 `tasks.md D-01` 明文禁止「第二套存储抽象 / 第二个注入符号」。架构师方案字面违反。
- **裁决**：保留 `FactSourceFileStorageService` 作为**唯一注入点与类名**，Local / COS 差异下沉为**内部 driver**，构造函数改为**可选参数**注入 driver。
- **理由（三条同时成立才选它）**：
  1. 满足 specs 字面约束，无需改动 specs 四件套正文；
  2. 保住 `apps/api/test/import-job-storage.integration.mjs:67` 的 `new FactSourceFileStorageService()` **无参**实例化，不破坏既有测试；
  3. **无论 Q-04（是否允许引入新抽象）上游怎么裁，都不返工**。

### D-2：COS driver 的 `assertWritable()` 禁止真实 PutObject —— 主理人裁定

- **冲突**：架构师设计沿用现状「启动时写探针」语义；私有桶上真实 PutObject 会产生垃圾对象，且 `/ready` 对存储产生写副作用违反 `REQ-15`。
- **裁决**：COS driver 的 `assertWritable()` 改为 `headBucket` + 权限校验，**不得**产生任何对象；`/ready` 探针对 COS **零写操作**。
- **兼容约束**：错误码仍映射为既有 `storage:down`，避免下游断言漂移。

### D-3：本轮零 DDL —— 主理人裁定

- **冲突**：架构师 `StoredFactSourceFile` 新增 `contentType`，涉及是否入库；幂等是否需数据库唯一约束。
- **实测依据**：009 迁移无 `contentType` 列；`idx_import_jobs_storage_key` 为**非唯一**索引。加唯一约束需触碰已冻结的迁移边界。
- **裁决**：
  - `contentType` 仅作**返回值 + COS 对象元数据**，**不入库**；
  - 幂等走**应用层**（sha256 + 业务键查重）；
  - 「新增 010 迁移加 `contentType` 列 + 幂等唯一约束」列为**独立待授权任务**，不进本轮。
- **已知残留风险（不隐藏）**：应用层幂等存在并发竞态窗口，无数据库唯一约束兜底。

### D-4：DB 只存逻辑键 —— 采纳架构师

- **裁决**：MySQL 只存逻辑键 `xx/<sha256>`，**不含 COS prefix**；prefix 属部署配置，由 COS driver 内部映射。
- **理由**：零 DDL、零数据迁移；历史行格式不变（现有正则 `^[a-f0-9]{2}\/[a-f0-9]{64}$` 不会对历史行报错）；Local / COS 的 DB 值可互换，回滚无需修数据。

### D-5：`deduplicated` 补偿护栏 —— 采纳架构师，并加强

- **裁决**：仅当 `deduplicated === false`（本次请求首次创建对象）才允许补偿删除；`true` 说明对象可能被其它批次引用，**绝不删**。
- **加强项**：删除前**再查 DB 是否仍有行引用该 sha256**，缓解架构师自述的 TOCTOU 窗口（R4）。
- **已知残留风险（不隐藏）**：极端并发下仍存在窄窗口，无法在本轮零 DDL 前提下彻底消除。

---

## 三、制度性冲突登记（只登记，本轮不擅改 specs 正文）

| 编号 | 冲突内容 | 本轮处置 |
|---|---|---|
| INST-01 | `tasks.md` §0.4「禁止删除生产对象」与 C 阶段要求的「MySQL 失败时删除已上传对象」补偿动作**字面冲突** | 登记，等待 Q-02 豁免裁定。**未裁定则 C-2 无法实现** |
| INST-02 | `requirements.md` L143-144 以「生成临时下载地址」为触发条件，与本轮「不生成公开对象 URL / 不用预签名 URL」冲突 | 本轮实现走 **API 服务端代理流式下载**，不动 specs 正文 |
| INST-03 | `access-control-matrix.md` **完全没有「应用运行时身份」主体** | API 容器持有 COS 凭据常态读写属新攻击面，未被治理；导致「匿名必须拒绝」在权限矩阵中**无落点可供验收**。登记为 ACL 缺口，需上游补矩阵 |

---

## 四、阻塞登记（BLOCKED）

### F 阶段整体 BLOCKED

| 编号 | 阻塞事实 | 依据 |
|---|---|---|
| BLOCK-F-01 | `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION` 全部 UNSET，未识别到批准的长期密钥注入设施 | 本机环境变量实测 |
| BLOCK-F-02 | `JWT_SECRET` UNSET —— 正是上次 CFS 隔离验证失败的诱因之一 | 本机环境变量实测 |
| BLOCK-F-03 | 目标私有 COS 桶未确定。`tcb storage buckets list -e zy-...` 报错，**拒绝猜测桶名** | CLI 实测 |

### 必须由 Codex 拍板的硬前置（未裁定不放行 C 阶段）

| 编号 | 问题 | 影响 |
|---|---|---|
| **Q-06 / R1** | **凭据形态**：`tcb secrets` 只有 `get` 且返回**当前登录会话的临时凭据**，长驻 CloudRun 服务会过期。方案 (a) 长期 SecretId/Key 环境变量注入；方案 (b) STS 临时凭据 + 服务内定时刷新 + `COS_SESSION_TOKEN`。(b) 需额外实现凭据刷新器与过期重试 | **已裁定（Codex PG-20260805-COS-D-CORRECTION）**：采用 **STS 临时凭据刷新**；长期密钥不得作为默认生产方案。**BLOCKED_STS_ISSUER_UNDEFINED**：真实 STS issuer 未确认，禁止编造 endpoint/角色/刷新协议，禁止 fake provider 冒充真实 STS。D1-D6 不因此阻塞 |
| **Q-02** | 是否豁免「禁止删除生产对象」以允许补偿删除 | 不豁免则 C-2 补偿路径无法实现 |
| **Q-03** | 是否允许新增 010 迁移（`contentType` 列 + 幂等唯一约束） | 涉及已冻结的迁移边界。本轮已按「不允许」执行 |
| **Q-05** | 隔离桶参数：桶名 / region / 授权级别 | 全未定义，F 阶段无法启动 |
| **R3** | L0 回滚的数据可见性缺口：切回 local driver 后，COS 期间上传的对象在本地盘不存在，源文件下载走 404（业务元数据不丢） | 需确认可接受 |
| **R5** | 保留期策略：`fact-import.service.ts:589` 有「已超出保留期」文案，但未核验是否有实际保留期实现。若配 COS 生命周期规则需与业务保留期对齐 | 待核验 + 待拍板 |

---

## 五、已核实的代码事实（交底遗漏项，主理人逐条实读复核）

| # | 事实 | 复核结果 |
|---|---|---|
| 1 | **CFS 硬校验有两处，不是一处** | `apps/api/src/runtime.config.ts:26-29` 另有**无条件**硬校验 `FACT_SOURCE_STORAGE_ROOT !== '/mnt/fact-source-files' → fail('FACT_SOURCE_STORAGE_ROOT_INVALID')`。**只改 `fact-source-storage.config.ts` 生产仍启动失败** |
| 2 | **存储服务有 3 个消费方，不止 facts** | `app.service.ts:36`（readiness）、`fact-import.service.ts:83`、`ws6.service.ts:98`（`:121` store / `:904` read）全部命中。ws6 不一并迁移会造成「半 COS 半本地盘」分裂状态 |
| 3 | **两个 Dockerfile 必须同步改** | `scripts/test/check-container-runtime.mjs:32` 断言根 `Dockerfile` 与 `apps/api/Dockerfile` normalize 后**完全相等**；`:44` 断言必须含 `required-persistent-mount`；`:45` 断言必须含 `FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files` |
| 4 | **`check-fact-storage-gate.mjs` 全文编码 CFS 语义** | `:9-18` 断言必须抛 `MOUNT_NOT_FOUND`，并以 `fuse.cosfs` 挂载行断言「通过」。去 CFS 后必红 |
| 5 | **构造签名陷阱** | `apps/api/test/import-job-storage.integration.mjs:67` 直接 `new FactSourceFileStorageService()` **无参**实例化。改构造签名即崩 → 这是 D-1 采用「可选参数 + 内部 driver」的硬约束来源 |
| 6 | **待核验项（未默认合规）** | `admin-facts.controller.ts` / `city-facts.controller.ts` 的**类级守卫装饰器本轮未逐行读取**，仅确认端点行号（:33 / :65）。`ws6/imports.controller.ts` 已确认 L18-19 有 `JwtAuthGuard, RolesGuard`。列为 C4 必做核验项 |

---

## 六、环境探测事实（只读，未触碰生产）

- CloudBase CLI **3.5.6** 已登录；zy 隔离环境 `zy-data-d2g9g1ghr47ac6254` 状态 **Normal**
- zy 默认存储 ACL = 「Only admin can read and write」（**私有**），满足「对象必须私有」
- `tcb secrets` **只有 `get`** 子命令，返回当前登录会话的**临时**凭据 → 见 Q-06
- zy 现存 5 个 CloudRun 服务，含 2 个失败 CFS 尝试（`biz-reporting-i1-cfs-fresh-286d338`、`biz-reporting-i1-cfs-286d338`），**均保留未动**
- 生产环境 `prod-d7g4xz9w403a092bd` 可见但**严格不在范围内，全程零指令**
- `pnpm` 不在 PATH，`npx --yes pnpm@9.15.0` 可用 → E 阶段工具链无阻塞
- 本轮 CLI 调用**全程未使用 `--force`**

---

## 七、状态

- A 阶段：架构师提交 `17bf683`，主理人已独立核验（`git show --stat` 仅 2 份文档，`git diff 286d338 HEAD --name-only` 无业务代码，`RETAINS_286d338=true`，治理产物 9 项状态未变）。裁决 D-1~D-5 已下发，架构师定向修订中。
- QA 基线门禁快照：进行中（目的是区分「本来就红」与「被改红」）。
- B / C / D / E / F 阶段：未开始。
- **无任何阶段可标记 REVIEW_COMPLETE。**
- **主理人不自行宣布 PASS / GO / 发布。**
