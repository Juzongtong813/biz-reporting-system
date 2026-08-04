# COS SDK 直连存储 — 任务分解（B / C / D 阶段）

- 配套设计：`specs/production-governance-20260802/design-cos-sdk-direct-storage.md`（冻结版）
- 基线提交：`286d338bc1f996ef0c1af2d2c47b8b3199d2fa21`
- 分支：`fix/i1-typeorm-migration-storage`
- 适用范围：B（存储适配层）、C（业务流程迁移）、D（配置与容器改造）
- 执行者：工程师；本文精确到文件级，可直接照做

---

## 0. 全局纪律（每个任务都适用）

1. **禁止** `git reset --hard`、`git checkout -- <path>`、`git push --force`、切换分支、删除未知文件
   （本工作区是 `E:/code2/biz-reporting-system-fix` 的 git worktree，共享 `.git`，破坏性操作会损坏已冻结的旧工作区）
2. **禁止** `git add -A` / `git add .`；提交一律精确 pathspec
3. **不得清理/覆盖/擅自提交**既有治理产物：`cloudbaserc.json`、`evidence/`、`workspace-recovery-*.json/.txt/.md`
4. **不得提交任何密钥**
5. 每个任务完成后跑该任务的"验收判据"，全绿再进下一个
6. 遇到与设计文档冲突的实际代码情况，**停下来上报**，不要自行偏离设计

---

## 1. 依赖包清单

### 1.1 新增生产依赖（`apps/api/package.json` → `dependencies`）

```json
"cos-nodejs-sdk-v5": "3.0.0"
```

**必须 exact pin（无 `^`、无 `~`），理由：**

1. **凭据与签名逻辑的补丁级变更会静默改变鉴权行为** —— COS SDK 的签名算法、header 处理位于 patch 版本可变更范围内；一次 `pnpm install` 拉到新 patch 就可能导致生产签名失败，而本仓库 F 阶段目前 **BLOCKED（无真实凭据）**，无法在 CI 中真实验证签名，因此必须锁死。
2. **本仓库其余关键安全依赖已采用 exact pin 惯例** —— 已核验 `apps/api/package.json` 中 `@nestjs/throttler: "6.5.0"`、`helmet: "8.3.0"` 均为 exact，存储凭据依赖属同等或更高敏感度。
3. **3.0.0 是 major 版本，caret 无保护价值** —— `^3.0.0` 允许 3.x 全部 minor，而 3.0.0 相对 2.x 是破坏性大版本，其 3.x 内部 API 尚未经本项目验证。

**版本核验记录（本轮实际执行 `npm view`）：**
- `latest` dist-tag = `3.0.0`；`beta` = `2.16.0-beta.9`
- `engines.node` = `>= 9` → 与容器 `node:20-alpine` 兼容
- 传递依赖仅 3 个：`cos-request@^1.3.0`、`cos-fast-xml-parser@^1.0.0`、`mime-types@^2.1.35`（攻击面小）
- 2.x 线在 `2.16.0-beta.*` 之后无更新的稳定版发布，`3.0.0` 为当前唯一稳定 latest
- **确认 `node_modules/cos-nodejs-sdk-v5` 当前不存在，`apps/api/package.json` 当前无此依赖**

**类型声明**：SDK 自带 `index.d.ts`（3.x），**先不要**加 `@types/cos-nodejs-sdk-v5`；若 `pnpm --filter @biz-reporting/api build` 报类型缺失，再评估，并在 B1 验收记录中说明。

### 1.2 锁文件

`pnpm-lock.yaml` 会因新增依赖变更 —— 这是 B1 任务**预期内**的唯一锁文件改动。除此之外**任何任务不得**改动 `pnpm-lock.yaml`。

---

## 2. 跨文件共享约定

### 2.1 错误码命名

- 存储层错误码统一 `SOURCE_FILE_*` 前缀，定义在 `apps/api/src/facts/storage/fact-source-storage.error.ts`
- **以下 4 个既有码字符串不得更改**（既有测试与审计日志依赖）：
  `SOURCE_FILE_HASH_MISMATCH`、`SOURCE_FILE_IMMUTABILITY_VIOLATION`、`SOURCE_FILE_STORAGE_KEY_INVALID`、`SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT`
- 新增码：`SOURCE_FILE_NOT_FOUND`、`SOURCE_FILE_STORAGE_UNAVAILABLE`、`SOURCE_FILE_STORAGE_FORBIDDEN`、`SOURCE_FILE_STORAGE_CONFIG_INVALID`
- 配置类启动错误码：`FACT_SOURCE_STORAGE_DRIVER_REQUIRED`、`FACT_SOURCE_STORAGE_DRIVER_INVALID`、`COS_REGION_REQUIRED`、`COS_BUCKET_REQUIRED`、`COS_BUCKET_INVALID`、`COS_SECRET_ID_REQUIRED`、`COS_SECRET_KEY_REQUIRED`
- 补偿/运维日志码：`SOURCE_FILE_COMPENSATION_DELETED`（warn）、`SOURCE_FILE_ORPHAN_OBJECT`（error）

### 2.2 日志脱敏规则（硬性）

| 字段 | 规则 |
|---|---|
| `COS_SECRET_KEY` | **绝不输出**，长度也不输出 |
| `COS_SESSION_TOKEN` | **绝不输出** |
| `COS_SECRET_ID` | 仅前 4 字符 + `****`，如 `AKID****` |
| `COS_BUCKET` / `COS_REGION` | 可输出（非机密，但**不得**进入 HTTP 响应体） |
| `storageKey` / `sha256` | 可进服务端日志与 `operation_log`；**不得**进 HTTP 响应体 |
| SDK 原始 error | 向上抛出前必须剥离 `headers.Authorization`、`request.headers`（可能含签名串） |

### 2.3 命名与目录约定

- 新目录：`apps/api/src/facts/storage/`
- 文件名 kebab-case；类名 PascalCase；DI 令牌 `SCREAMING_SNAKE` 的 `Symbol`
- 注入令牌：`FACT_SOURCE_STORAGE`、`COS_CLIENT`
- 业务层统一 `@Inject(FACT_SOURCE_STORAGE) private readonly storage: FactSourceStorage`

### 2.4 HTTP 响应约定

- 存储错误**一律不**透传到响应体；下载失败统一 `NotFoundException`，具体原因只进 `operation_log`
- 越权访问返回 **404**（不用 403），防存在性探测
- 下载响应必须带 `Cache-Control: no-store`

---

## 3. 任务总览

| ID | 阶段 | 任务 | 依赖 | 优先级 |
|---|---|---|---|---|
| B1 | B | 引入 COS SDK 依赖 | — | P0 |
| B2 | B | 存储接口 + 错误模型 + key 工具 | B1 | P0 |
| B3 | B | Local adapter（包装既有实现） | B2 | P0 |
| B4 | B | COS 客户端端口 + SDK 工厂 | B2 | P0 |
| B5 | B | COS adapter | B4 | P0 |
| B6 | B | 存储配置模型 + adapter 选择 | B2 | P0 |
| B7 | B | StorageModule 装配 | B3,B5,B6 | P0 |
| B8 | B | 适配层单元测试（无凭据可跑） | B3,B5,B6 | P0 |
| C1 | C | `FactImportService` 迁移 + 补偿 | B7 | P0 |
| C2 | C | `Ws6Service` 迁移 + 补偿 | B7 | P0 |
| C3 | C | `AppService` readiness 迁移 | B7 | P0 |
| C4 | C | 下载端点鉴权核验与加固 | C1 | P0 |
| C5 | C | 业务层迁移测试 | C1,C2,C3,C4 | P0 |
| D1 | D | 解除双处 CFS 强校验 | B6 | P0 |
| D2 | D | Dockerfile 双文件去 CFS | D1 | P0 |
| D3 | D | 架构依赖门禁新增规则 | C1,C2 | P0 |
| D4 | D | 存储门禁与预检脚本改写 | D1,D2 | P0 |
| D5 | D | 孤儿对象盘点脚本（只读） | C1 | P1 |
| D6 | D | 部署配置与环境变量文档 | D1,D2,D4 | P1 |

合计 **20 个任务**（B 8 / C 5 / D 7）。

---

## 4. B 阶段：存储适配层

### B1 — 引入 COS SDK 依赖

- **目标文件**：`apps/api/package.json`、`pnpm-lock.yaml`
- **依赖**：无
- **内容**：`dependencies` 中新增 `"cos-nodejs-sdk-v5": "3.0.0"`（exact，无 caret），按字母序插入；执行 `pnpm install` 更新锁文件
- **验收判据**：
  1. `node -e "console.log(require('./apps/api/package.json').dependencies['cos-nodejs-sdk-v5'])"` 输出 `3.0.0`（**无 `^`**）
  2. `node_modules/cos-nodejs-sdk-v5/package.json` 存在且 `version === '3.0.0'`
  3. `git diff --name-only` 只含 `apps/api/package.json` 与 `pnpm-lock.yaml`
  4. `pnpm --filter @biz-reporting/api build` 通过

### B2 — 存储接口 + 错误模型 + key 工具

- **目标文件**（新增）：
  - `apps/api/src/facts/storage/fact-source-storage.interface.ts`
  - `apps/api/src/facts/storage/fact-source-storage.error.ts`
  - `apps/api/src/facts/storage/storage-key.util.ts`
- **依赖**：B1
- **内容**：
  - 接口按设计 §2.2 原样落地（`FactSourceObjectMeta`、`StoredFactSourceFile`、`PutFactSourceFileInput`、`FactSourceStorage`、`FACT_SOURCE_STORAGE`）
  - 错误类按设计 §2.3
  - `storage-key.util.ts` 导出：
    - `buildLogicalKey(sha256: string): string` → `${sha.slice(0,2)}/${sha}`
    - `assertLogicalStorageKey(key: string): void` → 正则 `^[a-f0-9]{2}\/[a-f0-9]{64}$`，不符抛 `SOURCE_FILE_STORAGE_KEY_INVALID`
    - 正则**必须与** `fact-source-file-storage.service.ts:90` 现有正则逐字符一致
- **验收判据**：
  1. 三个文件仅含类型/常量/纯函数，**无** `node:fs`、`cos-nodejs-sdk-v5`、`@nestjs/typeorm` 导入
  2. `pnpm --filter @biz-reporting/api build` 通过
  3. `StoredFactSourceFile` 含 `storageKey`/`size`/`storedAt` 三字段（与既有 `StoredFactSourceFile` 兼容）+ `sha256`/`contentType`/`deduplicated`

### B3 — Local adapter（包装既有实现）

- **目标文件**：
  - 新增 `apps/api/src/facts/storage/local-fact-source-storage.ts`
  - **只读参考**（不修改）`apps/api/src/facts/fact-source-file-storage.service.ts`
- **依赖**：B2
- **内容**：按设计 §3.1，`LocalFactSourceStorage implements FactSourceStorage`，构造注入既有 `FactSourceFileStorageService`，内部复用其 `store/read/exists/assertReadable/assertWritable`
  - `put()`：先 `exists()` 判 `deduplicated`，再委托 `store()`
  - `get()`：`read()`，ENOENT → `FactSourceStorageError('SOURCE_FILE_NOT_FOUND')`
  - `head()`：`stat` 取 size/mtime，不存在返回 `null`
  - `delete()`：`unlink`，ENOENT 静默成功
- **⚠️ 硬性约束**：**不得修改 `FactSourceFileStorageService` 的构造函数签名**（`apps/api/test/import-job-storage.integration.mjs:67` 无参 `new`，改签名会打断该测试）
- **验收判据**：
  1. `grep -n "constructor" apps/api/src/facts/fact-source-file-storage.service.ts` 无输出（仍无显式构造函数）
  2. `node apps/api/test/import-job-storage.integration.mjs` 仍通过（或与改动前状态一致）
  3. `put()` 同一 buffer 连调两次：第一次 `deduplicated===false`，第二次 `true`，两次 `storageKey` 相同

### B4 — COS 客户端端口 + SDK 工厂

- **目标文件**（新增）：
  - `apps/api/src/facts/storage/cos-client.interface.ts`
  - `apps/api/src/facts/storage/cos-client.factory.ts`
- **依赖**：B2
- **内容**：
  - 端口按设计 §4.1（`CosClientPort`、`COS_CLIENT`），**不导出任何 SDK 类型**
  - 工厂把 SDK 回调式 API 包成 Promise，注入 `Bucket`/`Region`
  - 实现超时（`COS_REQUEST_TIMEOUT_MS`，默认 30000）与重试（`COS_MAX_RETRIES`，默认 2；指数退避 `200ms * 2^n` + 全抖动）
  - 重试仅对：网络错误 / 超时 / 5xx / 429；**403、404 不重试**
  - 错误映射按设计 §4.6
  - 抛出前剥离 `headers.Authorization` 与 `request.headers`
- **⚠️ 硬性约束**：`cos-client.factory.ts` 是**全仓库唯一**允许 `import ... from 'cos-nodejs-sdk-v5'` 的文件
- **验收判据**：
  1. `grep -rn "cos-nodejs-sdk-v5" apps/api/src` 只命中 `cos-client.factory.ts` 一处
  2. `grep -rn "getObjectUrl\|getAuth(" apps/api/src` 无输出
  3. `pnpm --filter @biz-reporting/api build` 通过

### B5 — COS adapter

- **目标文件**（新增）：`apps/api/src/facts/storage/cos-fact-source-storage.ts`
- **依赖**：B4
- **内容**：`CosFactSourceStorage implements FactSourceStorage`，构造注入 `CosClientPort` + 配置
  - prefix 映射：`objectKey = prefix + logicalKey`；**对外与持久化一律用 logicalKey**（设计 §4.2）
  - `put()`：sha 校验 → `head` 探测 → 命中且 size 一致则 `deduplicated=true` 直接返回；size 不一致抛 `SOURCE_FILE_IMMUTABILITY_VIOLATION`；未命中则 `putObject`（**不传 `ACL`**）
  - `assertReadable()`：对固定探针 key 做 `headObject`，404 视为**正常**（桶可达即可）；403/网络错误视为失败
  - `assertWritable()`：put 一个探针对象后 delete
- **⚠️ 硬性约束**：不得生成任何 URL；不得传 `ACL`；不得把 prefix 写入返回的 `storageKey`
- **验收判据**：
  1. `grep -n "ACL" apps/api/src/facts/storage/cos-fact-source-storage.ts` 无输出
  2. 伪 `CosClientPort` 下 `put()` 返回的 `storageKey` 匹配 `^[a-f0-9]{2}/[a-f0-9]{64}$`（**不含 prefix**）
  3. 伪客户端记录到的 `putObject.Key` **含** prefix
  4. `head` 命中时 `putObject` **未被调用**（幂等验证）

### B6 — 存储配置模型 + adapter 选择

- **目标文件**（新增）：`apps/api/src/facts/storage/storage-driver.config.ts`
- **依赖**：B2
- **内容**：按设计 §4.4
  - `resolveStorageDriver(env): 'local' | 'cos'` —— production 下缺失即抛 `FACT_SOURCE_STORAGE_DRIVER_REQUIRED`，非法值抛 `FACT_SOURCE_STORAGE_DRIVER_INVALID`，非 production 默认 `local`
  - `resolveCosConfig(env)` —— 校验 `COS_REGION`/`COS_BUCKET`/`COS_SECRET_ID`/`COS_SECRET_KEY`，bucket 正则 `^[a-z0-9-]+-\d{5,}$`
  - 可选：`COS_SESSION_TOKEN`、`COS_OBJECT_PREFIX`（默认 `fact-source-files/`，非空时必须以 `/` 结尾）、`COS_REQUEST_TIMEOUT_MS`、`COS_MAX_RETRIES`
  - **纯函数，不读 `process.env` 全局**（env 由参数传入，便于测试）
- **⚠️ 硬性约束**：**禁止任何隐式回退**（不得"COS 配置缺失就悄悄用 local"）
- **验收判据**：
  1. production + 无 driver → 抛 `FACT_SOURCE_STORAGE_DRIVER_REQUIRED`
  2. production + driver=cos + 缺任一 COS 变量 → 抛对应 `COS_*_REQUIRED`
  3. 抛出的错误 message **不含**任何 secret 值（用含假密钥的 env 断言）
  4. 非 production + 无 driver → 返回 `'local'`

### B7 — StorageModule 装配

- **目标文件**：
  - 新增 `apps/api/src/facts/storage/fact-source-storage.module.ts`
  - 修改 `apps/api/src/facts/facts.module.ts`
- **依赖**：B3、B5、B6
- **内容**：
  - `FactSourceStorageModule` 提供 `FACT_SOURCE_STORAGE`，`useFactory` 依据 `resolveStorageDriver()` 返回 `LocalFactSourceStorage` 或 `CosFactSourceStorage`
  - 同时提供 `COS_CLIENT`（driver=cos 时才实例化真实客户端）
  - `exports: [FACT_SOURCE_STORAGE]`
  - `facts.module.ts` 导入该模块；**保留** `FactSourceFileStorageService` 在 providers/exports（Local adapter 依赖它，且 `ws6` 现有注入未迁移前仍需要）
- **验收判据**：
  1. `pnpm --filter @biz-reporting/api build` 通过
  2. 以 `NODE_ENV=test`（driver 默认 local）启动应用上下文成功，`FACT_SOURCE_STORAGE` 解析为 `LocalFactSourceStorage`
  3. 以 driver=cos + 假 COS 配置启动，解析为 `CosFactSourceStorage`（不发真实请求）
  4. `facts.module.ts` 的 `exports` 仍含 `FactsService`（不破坏既有导出契约）

### B8 — 适配层单元测试（无凭据可跑）

- **目标文件**（新增）：
  - `apps/api/test/storage/fact-source-storage.local.test.mjs`
  - `apps/api/test/storage/fact-source-storage.cos.test.mjs`（伪 `CosClientPort`）
  - `apps/api/test/storage/storage-driver.config.test.mjs`
  - 修改 `scripts/test/run-unit.mjs`（注册新测试）
- **依赖**：B3、B5、B6
- **内容**：覆盖
  - Local：put/get/head/exists/delete、幂等 `deduplicated`、hash 不符、key 非法、路径越界
  - COS（伪客户端）：prefix 映射、head-then-put 幂等、不传 ACL、错误映射四类、重试次数与 403/404 不重试、超时
  - Config：B6 四条验收
  - **契约一致性测试**：同一组用例分别跑 Local 与 COS(伪) 两个实现，断言可观测行为一致
- **⚠️ 硬性约束**：**不得**依赖任何真实 COS 凭据或网络
- **验收判据**：
  1. `COS_SECRET_ID`/`COS_SECRET_KEY` 均 UNSET 下 `pnpm test:unit` 全绿
  2. 断网环境下同样全绿
  3. 契约一致性测试对两个实现均通过

---

## 5. C 阶段：业务流程迁移

### C1 — `FactImportService` 迁移 + 补偿

- **目标文件**：`apps/api/src/facts/fact-import.service.ts`
- **依赖**：B7
- **内容**：
  - 构造注入由 `FactSourceFileStorageService` 改为 `@Inject(FACT_SOURCE_STORAGE) storage: FactSourceStorage`（`:83`）
  - `store(...)` → `storage.put({ buffer, originalName, expectedSha256 })`（`:95`、`:128`）
  - `exists(...)` → `storage.exists(...)`（`:562`、`:587`、`:668`）
  - `read(...)` → `storage.get(...)`（`:593`）
  - **新增补偿**：`persistCostBatch` / `persistOrderBatch` 的 `dataSource.transaction(...)` 外层包 try/catch，按设计 §6.3：
    - `evidence.deduplicated === false` → `storage.delete()`，日志 `SOURCE_FILE_COMPENSATION_DELETED`
    - 删除失败 → 日志 `SOURCE_FILE_ORPHAN_OBJECT` + 写 `operation_log`（`action_type='fact_source_object_orphaned'`, `result_status='failed'`），**不吞原始错误**
    - `deduplicated === true` → **不删除**
  - **建议实施 R4 缓解**（设计 §11）：删除前查 `fact_import_batch` 是否仍有行引用该 sha256，有则不删
- **⚠️ 必须保留不变**：
  - `getSourceFile()`（`:573-604`）的 7 步安全链路，尤其 **`hash(buffer) !== batch.fileSha256 → integrity_failed`**（`:598`）
  - `auditSourceFileDownload()` 的全部审计分支
  - 失败路径 `effectiveAt: null`（`:181`、`:310`）
  - 越权返回 `NotFoundException`（`:579-582`）
- **验收判据**：
  1. `grep -n "node:fs\|from 'fs'" apps/api/src/facts/fact-import.service.ts` 无输出
  2. `grep -n "FactSourceFileStorageService" apps/api/src/facts/fact-import.service.ts` 无输出
  3. 构造 put 成功但事务抛错的用例 → 伪存储的 `delete` **被调用 1 次**且 DB 无批次行
  4. 同上但 `deduplicated=true` → `delete` **未被调用**
  5. `delete` 抛错时原始业务错误仍向上抛出，且 `operation_log` 有 `fact_source_object_orphaned` 行

### C2 — `Ws6Service` 迁移 + 补偿

- **目标文件**：`apps/api/src/ws6/ws6.service.ts`、`apps/api/src/ws6/ws6.module.ts`
- **依赖**：B7
- **内容**：
  - 构造注入改为 `FACT_SOURCE_STORAGE`（`:98`）
  - `store(...)` → `storage.put(...)`（`:121`）
  - `read(...)` → `storage.get(...)`（`:904`）
  - `createImportJob`（`:101-153`）：`put` 在 `importJobRepo.save()` 之前，需加同款补偿（save 失败 → 按 §6.3 处理）
  - `ws6.module.ts` 导入 `FactSourceStorageModule`
- **⚠️ 保留**：`store` 失败则不创建 job 的现有语义（`:111-112` 注释所述 D-01 约定）
- **验收判据**：
  1. `grep -n "FactSourceFileStorageService" apps/api/src/ws6/ws6.service.ts` 无输出
  2. `put` 失败 → 无 `import_job` 行
  3. `put` 成功 + `save` 失败 → 补偿删除被调用（`deduplicated=false` 时）
  4. `pnpm --filter @biz-reporting/api build` 通过

### C3 — `AppService` readiness 迁移

- **目标文件**：`apps/api/src/app.service.ts`、`apps/api/src/app.module.ts`
- **依赖**：B7
- **内容**：`:36` 注入改为 `FACT_SOURCE_STORAGE`；`:114` `assertReadable()` 走接口；`app.module.ts` 导入 `FactSourceStorageModule`
- **⚠️ 保留**：5 秒缓存、2 秒超时、in-flight 去重、`timeout`/`dependency_error` 稳定依赖码（`:100-103`）
- **验收判据**：
  1. driver=local 且目录可读 → `GET /api/health/ready` 200，`checks.storage === 'up'`
  2. 伪 COS 客户端 head 抛超时 → 503 且 `checks.storage === 'timeout'`
  3. 伪 COS 抛 403 → 503 且 `checks.storage === 'dependency_error'`
  4. 响应体**不含** bucket/region/密钥
  5. 并发 100 次 ready 只触发一次依赖探测（既有行为不回归）

### C4 — 下载端点鉴权核验与加固

- **目标文件**：
  - 核验（必要时修改）`apps/api/src/facts/admin-facts.controller.ts`（端点 `:33`）
  - 核验（必要时修改）`apps/api/src/facts/city-facts.controller.ts`（端点 `:65`）
  - 只读核验 `apps/api/src/ws6/imports.controller.ts`（`:40`，已确认类级 `JwtAuthGuard, RolesGuard` @L18-19）
- **依赖**：C1
- **内容**：
  > **本任务源于设计 §9.1 的诚实声明**：`admin-facts.controller.ts` 与 `city-facts.controller.ts` 的**类级守卫装饰器本轮未逐行核验**，不得默认合规。
  - 逐行读取两个控制器的类头装饰器，确认 `@UseGuards(JwtAuthGuard, RolesGuard)` 与 `@Roles(...)` 存在且角色正确
  - 确认三个下载端点均有 `@Header('Cache-Control', 'no-store')`，缺失则补
  - 确认响应体不含 `storageKey`/bucket/region/COS 域名
  - **注意**：`publicBatch()`（`fact-import.service.ts:648`）目前**会返回 `sourceFileStorageKey`**。评估其消费方；若前端不需要，建议移除；若移除影响面大，至少确认它只是 `xx/<sha>` 逻辑键（不含 prefix、不含 bucket），并记录决策
- **验收判据**：
  1. 无 token 请求三个端点 → **401**
  2. 角色不符 → **403**
  3. 城市用户访问他城市批次 → **404**（不是 403）
  4. 三个端点响应头含 `Cache-Control: no-store`
  5. `grep -rn "myqcloud\|cos\.ap-\|COS_BUCKET" apps/api/src/**/*.controller.ts` 无输出
  6. `publicBatch` 的 `sourceFileStorageKey` 决策已记录

### C5 — 业务层迁移测试

- **目标文件**（新增/修改）：
  - `apps/api/test/storage/fact-import-compensation.test.mjs`
  - `apps/api/test/storage/source-file-download-auth.test.mjs`
  - 修改 `scripts/test/run-unit.mjs`
- **依赖**：C1、C2、C3、C4
- **内容**：覆盖补偿三分支、状态机不变量（失败路径 `effective_at` 恒 `null`）、下载鉴权 401/403/404、完整性校验失败 → 404 + `integrity_failed` 审计
- **验收判据**：
  1. 无凭据、断网下 `pnpm test:unit` 全绿
  2. 存在断言"失败批次 `effective_at IS NULL`"的用例
  3. 存在断言"`integrity_failed` 时返回 404 且响应体不含内部错误码"的用例

---

## 6. D 阶段：配置与容器改造

### D1 — 解除双处 CFS 强校验

- **目标文件**：
  - `apps/api/src/facts/fact-source-storage.config.ts`
  - **`apps/api/src/runtime.config.ts`（`:27-29`）**
  - `apps/api/src/facts/fact-source-file-storage.service.ts`（`onModuleInit` `:18-26`）
- **依赖**：B6
- **内容**：
  - `fact-source-storage.config.ts`：`assertProductionFactSourceStorage()` 增加 driver 参数，**仅 driver=local 时**执行原挂载四连校验；driver=cos 时直接返回。**保留** `PRODUCTION_FACT_SOURCE_STORAGE_ROOT` 常量与全部既有错误码字符串（L0 回滚需要）
  - **`runtime.config.ts:27-29`**：将无条件 `FACT_SOURCE_STORAGE_ROOT !== '/mnt/fact-source-files' → FACT_SOURCE_STORAGE_ROOT_INVALID` 改为：
    ```
    driver === 'local' → 保持原校验
    driver === 'cos'   → 改为校验 COS_REGION/COS_BUCKET/COS_SECRET_ID/COS_SECRET_KEY 齐备
    driver 缺失/非法   → fail('FACT_SOURCE_STORAGE_DRIVER_REQUIRED' / '_INVALID')
    ```
  - `fact-source-file-storage.service.ts` 的 `onModuleInit`：driver=cos 时跳过 mountinfo 读取与挂载断言（该实例此时不在生产路径上）
- **⚠️ 这是全 D 阶段最易踩坑处**：`runtime.config.ts` 是**交底未提及、本轮新发现的第二处硬校验**。只改第一处会导致生产启动仍然失败于 `[RUNTIME_CONFIG] FACT_SOURCE_STORAGE_ROOT_INVALID`
- **⚠️ 不得**删除 local 分支（L0 回滚依赖）
- **验收判据**：
  1. `grep -rn "fact-source-files" apps/api/src` 的每一处命中都在 driver=local 条件分支内
  2. production + driver=cos + 全套 COS 变量 + **无** `FACT_SOURCE_STORAGE_ROOT` → `validateRuntimeEnvironment()` **通过**
  3. production + driver=local + `/mnt/fact-source-files` + 有挂载 → 通过（回滚路径可用）
  4. production + driver=cos + 缺 `COS_BUCKET` → 抛 `COS_BUCKET_REQUIRED`
  5. production + 无 driver → 抛 `FACT_SOURCE_STORAGE_DRIVER_REQUIRED`

### D2 — Dockerfile 双文件去 CFS

- **目标文件**：`Dockerfile`（根）、`apps/api/Dockerfile`
- **依赖**：D1
- **内容**：
  - 移除 L41-42 的 `mkdir -p /mnt/fact-source-files && chown 10001:10001 /mnt/fact-source-files`
  - 移除 L45 `ENV FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files`
  - 移除 L46 `LABEL com.biz-reporting.required-persistent-mount=...`
  - 新增 `ENV FACT_SOURCE_STORAGE_DRIVER=cos`
  - **保留**：`addgroup -g 10001` / `adduser -u 10001` / `COPY --chown=10001:10001` / `USER 10001` / HEALTHCHECK `/api/health/live` / `EXPOSE 3000`
  - **禁止**在 Dockerfile 中出现任何 `COS_SECRET_*`（密钥只运行时注入）
- **⚠️ 硬性约束**：`scripts/test/check-container-runtime.mjs:32` 断言两个 Dockerfile 规范化后**完全一致**，**必须同步修改**
- **验收判据**：
  1. `grep -n "mnt/fact-source-files\|required-persistent-mount" Dockerfile apps/api/Dockerfile` 无输出
  2. `grep -n "COS_SECRET" Dockerfile apps/api/Dockerfile` 无输出
  3. 两文件按 `check-container-runtime.mjs:31` 的 normalize 规则比较结果相等
  4. `USER 10001`、`health/live`、`EXPOSE 3000` 仍在

### D3 — 架构依赖门禁新增规则

- **目标文件**：`scripts/architecture/check-dependencies.mjs`
- **依赖**：C1、C2
- **内容**：新增三条规则（编号建议 `AR-R7-a/b/c`，并在文件头注释块补充说明）
  - `AR-R7-a`：`apps/api/src/**` 除 `facts/storage/local-fact-source-storage.ts` 与 `facts/fact-source-file-storage.service.ts` 外，禁止 `node:fs` / `fs` / `node:fs/promises` 导入
  - `AR-R7-b`：`apps/api/src/**` 除 `facts/storage/cos-client.factory.ts` 外，禁止 `cos-nodejs-sdk-v5` 导入
  - `AR-R7-c`：`apps/api/src/**` 与 `apps/admin-web/src/**` 禁止出现 `getObjectUrl`、`getAuth(`、`myqcloud.com`、`cos.ap-` 字面量
- **⚠️ 注意**：AR-R7-a 可能命中既有合规用法（如读 `/proc/self/mountinfo`、配置读取）。**先跑一遍统计命中，把真实豁免项显式加入白名单常量并注释理由**，不要为了过门禁而放宽规则
- **验收判据**：
  1. `pnpm test:architecture` 全绿
  2. 人为在 `facts.service.ts` 插入 `import { readFile } from 'node:fs/promises'` → 门禁报 `AR-R7-a` 并非零退出（验证后**移除**该临时改动）
  3. 人为插入 `getObjectUrl` → 报 `AR-R7-c`（验证后移除）
  4. 白名单每一项都有注释说明豁免理由

### D4 — 存储门禁与预检脚本改写

- **目标文件**：
  - `scripts/test/check-fact-storage-gate.mjs`（**全文改写**）
  - `scripts/test/check-container-runtime.mjs`（`:44-45`）
  - `scripts/test/check-production-runtime-config.mjs`（`:30`）
  - `scripts/test/run-deployment-preflight.mjs`（`:36`）
  - `scripts/test/i1-manifest.json`（`:57`）
  - 视失败情况修改：`apps/api/test/login-security.test.cjs:107`、`apps/api/test/security-headers.test.mjs:90`、`scripts/test/run-auth-v3.mjs:93,350`、`scripts/test/run-facts-v31.mjs:32`
- **依赖**：D1、D2
- **内容**：
  - `check-fact-storage-gate.mjs`：改为断言 driver 选择与 COS 配置校验（B6 的四条），**并保留** driver=local 分支的原挂载断言（回滚路径必须有门禁守护）；末行输出改为 `FACT_SOURCE_STORAGE_GATE_OK driver=<local|cos>`
  - `check-container-runtime.mjs:44-45`：删除 `required-persistent-mount` 与 `FACT_SOURCE_STORAGE_ROOT=/mnt/...` 两条断言，改为断言 `ENV FACT_SOURCE_STORAGE_DRIVER=cos` 存在 且 Dockerfile **不含** `COS_SECRET`
  - 其余脚本：补 driver 与 COS 假变量，使 production 样例环境能通过校验
  - `i1-manifest.json:57`：`requiredEnvironment` 由 `["FACT_SOURCE_STORAGE_ROOT"]` 改为 `["FACT_SOURCE_STORAGE_DRIVER","COS_REGION","COS_BUCKET"]`（**不含 secret 名以外的值**，且**不得**写入任何真实值）
- **⚠️ 硬性约束**：脚本中所有 COS 变量样例值必须是**明显的假值**（如 `COS_SECRET_ID=AKIDTESTTESTTESTTEST`），**禁止**任何真实凭据
- **验收判据**：
  1. `pnpm test:storage-gate` 全绿
  2. `pnpm test:deployment-preflight` 全绿
  3. `node scripts/test/check-container-runtime.mjs` 全绿
  4. `pnpm test:unit && pnpm test:architecture` 全绿
  5. `git diff` 中无任何真实密钥（人工复核 + `grep -rn "AKID" scripts/ | grep -v TEST`）

### D5 — 孤儿对象盘点脚本（只读）

- **目标文件**（新增）：`scripts/oneoff/list-orphan-cos-objects.mjs`
- **依赖**：C1
- **优先级**：P1
- **内容**：列举 COS 中 prefix 下全部对象 → 与 DB 中 `fact_import_batch.source_file_storage_key` ∪ `import_job.source_file_storage_key` 求差集 → 输出 JSON 报告（`storageKey`、`size`、`lastModified`）
- **⚠️ 硬性约束**：**只读，绝不执行删除**；必须支持 `--dry-run` 为默认且**不提供**删除开关；输出不得含密钥
- **验收判据**：
  1. `grep -n "deleteObject\|delete(" scripts/oneoff/list-orphan-cos-objects.mjs` 无输出
  2. 无凭据时给出清晰报错并 exit 非 0（不静默假成功）
  3. 报告为合法 JSON，且不含 `COS_SECRET*`

### D6 — 部署配置与环境变量文档

- **目标文件**：
  - 新增 `specs/production-governance-20260802/cos-storage-runtime-env.md`
  - **仅在确有必要时**修改 `cloudbaserc.json`
- **依赖**：D1、D2、D4
- **优先级**：P1
- **内容**：完整环境变量清单（名称、必填条件、示例**占位值**）、CloudRun 注入方式、L0/L1/L2 回滚操作手册、readiness 排障对照表
- **⚠️ 极重要**：`cloudbaserc.json` 是**既有未提交治理产物**（经核验 `git diff` 为空，仅行尾差异）。**除非确有必要否则不要动它**；若必须改，**只改必要行**，绝不重写全文，且必须在提交说明中单列
- **⚠️** 文档中**只能**写占位值（如 `COS_SECRET_ID=<runtime-injected>`），**禁止**任何真实值
- **验收判据**：
  1. `grep -rn "AKID[A-Za-z0-9]\{10,\}" specs/production-governance-20260802/` 无输出
  2. 文档含 L0/L1/L2 三级回滚可执行步骤，且**不含** `reset --hard` / `checkout --` / `push --force`
  3. 若改了 `cloudbaserc.json`，`git diff cloudbaserc.json` 只显示预期的必要行

---

## 7. 依赖关系图

```
B1 ─► B2 ─┬─► B3 ──────────┐
          ├─► B4 ─► B5 ────┤
          └─► B6 ─┬────────┴─► B7 ─┬─► C1 ─┬─► C4 ─┐
                  │                 ├─► C2 ─┤       ├─► C5
                  │                 └─► C3 ─┘       │
                  │                                  │
                  └─► D1 ─► D2 ─► D4                 │
                       │           ▲                 │
                       └───────────┘                 │
          C1,C2 ────────────────► D3                 │
          C1 ───────────────────► D5                 │
          D1,D2,D4 ─────────────► D6                 │
```

**关键路径**：`B1 → B2 → B4 → B5 → B7 → C1 → C4 → C5`

**可并行**：
- B3 / B4 / B6（均只依赖 B2）
- C1 / C2 / C3（均只依赖 B7）
- D1 可在 B6 完成后与 C 阶段并行启动

---

## 8. 阶段出口判据

**B 阶段出口**：`pnpm test:unit` 全绿（无凭据、断网）；`grep -rn "cos-nodejs-sdk-v5" apps/api/src` 仅 1 处命中。

**C 阶段出口**：业务层零 `fs`/零 SDK 直接依赖；补偿三分支有测试；下载端点 401/403/404 有测试；`pnpm test:unit` 全绿。

**D 阶段出口**：
```
pnpm test:storage-gate
pnpm test:deployment-preflight
pnpm test:unit
pnpm test:architecture
pnpm test:migrations:ledger
node scripts/test/check-container-runtime.mjs
```
全部通过；且 `git status --porcelain=v1` 中 `cloudbaserc.json`、`evidence/`、`workspace-recovery-*` 状态与本轮开始时**一致**。

---

## 9. 全程不变量（每个任务完成后自检）

1. `git log --oneline -1` 的父链上 `286d338` 始终存在
2. 既有治理产物未被清理/覆盖/擅自提交
3. 无密钥进入 Git（`git diff --cached` 人工复核）
4. `FactSourceFileStorageService` 构造函数保持无参
5. 根 Dockerfile ≡ `apps/api/Dockerfile`
6. 失败路径 `effective_at` 恒为 `null`
7. 无任何公开/预签名 URL 生成代码
