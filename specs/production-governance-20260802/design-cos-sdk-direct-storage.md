# COS SDK 直连存储架构设计（冻结版）

- 文档状态：**A 阶段冻结**，B/C/D 阶段实现必须遵循本文
- 分支：`fix/i1-typeorm-migration-storage`
- 基线提交：`286d338bc1f996ef0c1af2d2c47b8b3199d2fa21`（fix: add typeorm metadata migration）
- 上游已拍板方案：**COS 对象存储 + 后端 COS Node.js SDK 直连**（不使用 CFS，不使用 MySQL BLOB）
- 作者：架构师
- 语言约定：正文简体中文，代码标识符/接口签名英文

---

## 0. 阅读须知：本文结论的证据来源

本文所有关于"现状"的陈述均来自对恢复工作区 `E:/code2/biz-reporting-system-recovery` 的**实际文件读取**，每条均附文件路径与行号。凡我未能读取到的内容，本文会显式标注"未核验"，不做推测。

**A 阶段未修改任何业务代码**，仅新增本文与任务分解文档两份 Markdown。

---

## 1. 现状核验结果（Ground Truth）

### 1.1 存储服务现状

`apps/api/src/facts/fact-source-file-storage.service.ts`（100 行）：

| 要素 | 现状 |
|---|---|
| 类名 | `FactSourceFileStorageService`，`@Injectable()` + `implements OnModuleInit` |
| **构造函数** | **无参数**（`private readonly root = resolveFactSourceStorageRoot(process.env, __dirname)` 为字段初始化） |
| `onModuleInit()` | production+linux 下读 `/proc/self/mountinfo` → `assertProductionFactSourceStorage()` → `mkdir` → `assertWritable()` |
| `assertReadable()` | `access(root, R_OK)`，readiness 只读探针 |
| `assertWritable()` | 写 `.readiness-probe-<pid>-<ts>` 探针文件后删除 |
| `assertReady()` | `@deprecated` 别名，等价 `assertWritable()` |
| `store(buffer, originalName, expectedSha256)` | 校验 sha256 → `storageKey = sha.slice(0,2) + '/' + sha` → `open(path,'wx')`；`EEXIST` 时读回比对，不一致抛 `SOURCE_FILE_IMMUTABILITY_VIOLATION` |
| `read(storageKey)` | `readFile(resolveKey(k))` |
| `exists(storageKey)` | `access(..., R_OK)` → boolean |
| `resolveKey()`（private） | 正则 `^[a-f0-9]{2}\/[a-f0-9]{64}$` + `startsWith(root + sep)` 越界校验 |
| 返回类型 | `StoredFactSourceFile { storageKey: string; size: number; storedAt: Date }` |

> **关键约束（易被忽略）**：`apps/api/test/import-job-storage.integration.mjs:67` 直接 `new FactSourceFileStorageService()` 无参实例化。**任何为该类增加必填构造参数的改法都会打断该集成测试**。本设计因此采取"新增接口 + 新增 Local/COS adapter 类"而非"改造原类构造签名"。

### 1.2 CFS 强制校验的**两处**落点（重要修正）

团队交底只提到一处，实际核验发现**两处独立硬校验**，D 阶段必须同时处理：

**落点 1** — `apps/api/src/facts/fact-source-storage.config.ts:9-25`
```
assertProductionFactSourceStorage(env, platform, mountInfo)
  → FACT_SOURCE_STORAGE_ROOT_REQUIRED_IN_PRODUCTION
  → FACT_SOURCE_STORAGE_ROOT_MUST_BE_ABSOLUTE
  → FACT_SOURCE_STORAGE_ROOT_MUST_EQUAL_/mnt/fact-source-files
  → FACT_SOURCE_STORAGE_PERSISTENT_MOUNT_NOT_FOUND（linux 下读 mountinfo）
```

**落点 2** — `apps/api/src/runtime.config.ts:27-29`（**交底未提及，本次新发现**）
```ts
if (normalize(config.FACT_SOURCE_STORAGE_ROOT) !== '/mnt/fact-source-files') {
  fail('FACT_SOURCE_STORAGE_ROOT_INVALID');
}
```
该校验在 `validateRuntimeEnvironment()` 内，`NODE_ENV=production` 时无条件执行。**只改落点 1 会导致生产启动仍然失败**，这是 D 阶段最易踩的坑。

### 1.3 存储服务的**全部消费方**（重要修正）

交底只提示了 facts 目录，实际核验发现 3 个生产消费方：

| 消费方 | 位置 | 调用 |
|---|---|---|
| `FactImportService` | `apps/api/src/facts/fact-import.service.ts` | `store()` @95, @128；`exists()` @562, @587, @668；`read()` @593 |
| **`Ws6Service`** | `apps/api/src/ws6/ws6.service.ts` | `store()` @121；`read()` @904 |
| **`AppService`** | `apps/api/src/app.service.ts:114` | `assertReadable()`（readiness 探针） |
| DI 注册 | `apps/api/src/facts/facts.module.ts:30-31` | `providers` + `exports` |
| 集成测试 | `apps/api/test/import-job-storage.integration.mjs:63-68` | 无参 `new` + 改 `FACT_SOURCE_STORAGE_ROOT` env |

**`Ws6Service` 是交底遗漏项**，C 阶段必须一并迁移，否则会出现"一半走 COS、一半走本地盘"的分裂状态。

### 1.4 容器与门禁现状

- 根 `Dockerfile`（55 行）：L41-42 `mkdir -p /mnt/fact-source-files && chown 10001:10001`；L45 `ENV FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files`；L46 `LABEL com.biz-reporting.required-persistent-mount=...`；L53 `USER 10001`；L49-50 HEALTHCHECK `/api/health/live`
- `apps/api/Dockerfile`（2037 字节）**存在**，且 `scripts/test/check-container-runtime.mjs:32` 断言其与根 Dockerfile **规范化后必须完全一致**。→ **D 阶段两个 Dockerfile 必须同步改**
- `scripts/test/check-container-runtime.mjs:44-45` 断言 Dockerfile **必须保留** `required-persistent-mount` 标签与 `FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files`。→ **去 CFS 后该门禁必然失败，D 阶段必须同步改写门禁断言**
- `scripts/test/check-fact-storage-gate.mjs` 全文断言 CFS 挂载语义（含 `fuse.cosfs` mountinfo 样例）。→ **必须改写为 COS 配置门禁**
- 其他受影响：`scripts/test/check-production-runtime-config.mjs:30`、`scripts/test/run-deployment-preflight.mjs:36`、`scripts/test/i1-manifest.json:57`、`scripts/oneoff/migrate-import-job-files.mjs:60`、`apps/api/test/login-security.test.cjs:107`、`apps/api/test/security-headers.test.mjs:90`、`scripts/test/run-auth-v3.mjs:93,350`、`scripts/test/run-facts-v31.mjs:32`

### 1.5 依赖与实体现状

- `apps/api/package.json` 依赖中**无** `cos-nodejs-sdk-v5`；`node_modules/cos-nodejs-sdk-v5` **不存在**（已核验）
- `fact_import_batch` 实体（`fact-import-batch.entity.ts`）：
  - `source_file_storage_key varchar(500) NULL`
  - `source_file_sha256 varchar(64)`（属性名 `fileSha256`）
  - `source_file_size bigint NULL`、`source_file_stored_at datetime NULL`
  - `status: 'processing' | 'completed' | 'failed'`
  - `lifecycle_status: 'processing' | 'current_effective' | 'effective_with_warning' | 'validation_failed'`
  - 唯一索引 `uk_fact_batch_city_kind_hash (city_id, fact_kind, source_file_sha256)`
- **`storage_key` 列宽 500，足以容纳 COS objectKey，本轮无需 DDL 迁移**（结论见 §4.2）

### 1.6 下载端点与鉴权现状

| 端点 | 文件 | 守卫 |
|---|---|---|
| `GET /api/admin/.../import-batches/:id/source-file` | `admin-facts.controller.ts:33` | 见 §9 |
| `GET /api/city/.../import-batches/:id/source-file` | `city-facts.controller.ts:65` | 见 §9 |
| `GET /api/imports/:jobId/source-file` | `ws6/imports.controller.ts:40` | `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(SYSTEM_ADMIN, CITY_USER)`（类级，L18-19） |

`FactImportService.getSourceFile()`（@573-604）现有安全链路已相当完整，**必须原样保留**：
1. 批次不存在 → 审计 `batch_not_found` + `NotFoundException`
2. 非 admin 且 `cityId` 不匹配 → 审计 `scope_denied` + `NotFoundException`（**不泄露存在性**）
3. 无 storageKey → 审计 `storage_key_missing`
4. `exists()` 为假 → 审计 `source_file_missing`
5. `read()` 抛错 → 审计 `source_file_read_failed`
6. **读回 hash ≠ `batch.fileSha256` → 审计 `integrity_failed` + 拒绝**
7. 成功 → 审计 `success`

---

## 2. 统一 `FactSourceStorage` 接口定义

### 2.1 设计目标

1. 业务层（`FactImportService` / `Ws6Service` / `AppService`）**只依赖接口**，不依赖 `fs`、不依赖 `cos-nodejs-sdk-v5`
2. 接口语义为**内容寻址不可变对象存储**，Local 与 COS 两种实现语义等价
3. 无真实 COS 凭据时，Local adapter + 可注入伪 COS 客户端即可跑通全部单元测试（F 阶段 BLOCKED 不阻塞 A~E）

### 2.2 接口文件

新增 `apps/api/src/facts/storage/fact-source-storage.interface.ts`：

```ts
/** 存储对象的元数据（不含正文） */
export interface FactSourceObjectMeta {
  /** 内容寻址键，格式恒为 `${sha256.slice(0,2)}/${sha256}` */
  storageKey: string;
  /** 字节数 */
  size: number;
  /** 内容 SHA-256（小写 hex，64 位） */
  sha256: string;
  /** MIME 类型；未知时为 'application/octet-stream' */
  contentType: string;
  /** 对象在存储侧的落盘/落桶时间 */
  storedAt: Date;
}

/** put 的返回值。保持与既有 StoredFactSourceFile 字段兼容（storageKey/size/storedAt） */
export interface StoredFactSourceFile extends FactSourceObjectMeta {
  /** true = 对象此前已存在且内容一致（幂等命中，未重复写入） */
  deduplicated: boolean;
}

export interface PutFactSourceFileInput {
  buffer: Buffer;
  /** 原始文件名，仅用于 contentType 推断与日志；不参与 key 生成 */
  originalName: string;
  /** 调用方预先计算的 sha256，实现必须重新计算并比对 */
  expectedSha256: string;
}

export interface FactSourceStorage {
  /** 幂等写入。返回 deduplicated=true 表示命中已有对象。 */
  put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile>;

  /** 读取完整正文。对象不存在时抛 FactSourceStorageError(NOT_FOUND)。 */
  get(storageKey: string): Promise<Buffer>;

  /** 读取元数据，不下载正文。对象不存在返回 null。 */
  head(storageKey: string): Promise<FactSourceObjectMeta | null>;

  /** 存在性判定。等价 head() !== null，但实现可走更廉价路径。 */
  exists(storageKey: string): Promise<boolean>;

  /**
   * 删除对象。**仅供补偿路径与运维清理使用，业务正常流程禁止调用。**
   * 对象不存在时必须静默成功（幂等删除）。
   */
  delete(storageKey: string): Promise<void>;

  /** 只读健康探针（readiness 用）。失败抛错。 */
  assertReadable(): Promise<void>;

  /** 读写健康探针（启动时一次）。失败抛错。 */
  assertWritable(): Promise<void>;
}

/** DI 注入令牌。业务层通过 @Inject(FACT_SOURCE_STORAGE) 获取。 */
export const FACT_SOURCE_STORAGE = Symbol('FACT_SOURCE_STORAGE');
```

### 2.3 错误模型

新增 `apps/api/src/facts/storage/fact-source-storage.error.ts`：

```ts
export type FactSourceStorageErrorCode =
  | 'SOURCE_FILE_HASH_MISMATCH'            // 入参 sha256 与实际内容不符（既有码，保留）
  | 'SOURCE_FILE_IMMUTABILITY_VIOLATION'   // 同 key 已存在但内容不同（既有码，保留）
  | 'SOURCE_FILE_STORAGE_KEY_INVALID'      // key 不符合内容寻址格式（既有码，保留）
  | 'SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT' // 本地路径越界（既有码，Local only）
  | 'SOURCE_FILE_NOT_FOUND'                // 对象不存在
  | 'SOURCE_FILE_STORAGE_UNAVAILABLE'      // 网络/超时/5xx，可重试
  | 'SOURCE_FILE_STORAGE_FORBIDDEN'        // 凭据无效/权限不足，不可重试
  | 'SOURCE_FILE_STORAGE_CONFIG_INVALID';  // 配置缺失或非法

export class FactSourceStorageError extends Error {
  constructor(
    readonly code: FactSourceStorageErrorCode,
    /** 可重试性，供上层决定是否退避重试 */
    readonly retryable: boolean = false,
    /** 原始错误，仅内部日志使用，禁止外泄到 HTTP 响应 */
    readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'FactSourceStorageError';
  }
}
```

**前 4 个错误码沿用现有字符串**，保证既有测试与审计日志断言不被打断。

### 2.4 依赖方向约束（硬性）

```
controllers ──► services（FactImportService / Ws6Service / AppService）
                   │
                   ▼  只依赖
            FactSourceStorage（interface，无任何 IO 依赖）
                   ▲  实现
        ┌──────────┴──────────┐
LocalFactSourceStorage   CosFactSourceStorage
   (node:fs)                (cos-nodejs-sdk-v5)
```

规则（应由 `scripts/architecture/check-dependencies.mjs` 新增规则强制，见任务 D3）：
- `apps/api/src/**` 中，除 `apps/api/src/facts/storage/local-fact-source-storage.ts` 外，**任何文件不得** `import ... from 'node:fs'` / `'fs'` / `'node:fs/promises'` 用于源文件正文读写
- `apps/api/src/**` 中，除 `apps/api/src/facts/storage/cos-*.ts` 外，**任何文件不得** `import ... from 'cos-nodejs-sdk-v5'`
- 业务服务只允许 `@Inject(FACT_SOURCE_STORAGE)`，禁止直接注入 `LocalFactSourceStorage` / `CosFactSourceStorage` 具体类

---

## 3. Local adapter 设计

### 3.1 与现有 `FactSourceFileStorageService` 的关系：**包装保留，不删除**

**决策：`LocalFactSourceStorage` 采用「内部复用现有实现 + 对外实现新接口」的包装式重构，`FactSourceFileStorageService` 类本身保留且构造签名不变。**

理由（基于实测约束，非偏好）：
1. `apps/api/test/import-job-storage.integration.mjs:67` 无参 `new FactSourceFileStorageService()`。改构造签名 → 该测试直接崩。
2. 现有内容寻址 + `wx` 原子写 + EEXIST 回读比对逻辑已通过既有门禁，**重写等于重新承担风险**。
3. E 阶段需要一个不依赖任何云凭据的可用实现，Local 必须始终可跑。

具体形态 —— 新增 `apps/api/src/facts/storage/local-fact-source-storage.ts`：

```ts
@Injectable()
export class LocalFactSourceStorage implements FactSourceStorage {
  // 复用现有服务实例（由 DI 提供），不复制其内部逻辑
  constructor(private readonly legacy: FactSourceFileStorageService) {}

  async put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile> { /* 见下 */ }
  async get(key: string): Promise<Buffer> { /* legacy.read + NOT_FOUND 映射 */ }
  async head(key: string): Promise<FactSourceObjectMeta | null> { /* stat */ }
  async exists(key: string): Promise<boolean> { return this.legacy.exists(key); }
  async delete(key: string): Promise<void> { /* unlink，ENOENT 静默 */ }
  async assertReadable(): Promise<void> { return this.legacy.assertReadable(); }
  async assertWritable(): Promise<void> { return this.legacy.assertWritable(); }
}
```

`put()` 的 `deduplicated` 判定：先 `legacy.exists(key)`，为真则 `deduplicated = true` 且跳过写入（`legacy.store()` 内部 EEXIST 分支已做回读比对，语义安全）；为假则调 `legacy.store()` 后置 `deduplicated = false`。存在 TOCTOU 竞态时退化为 `deduplicated = false`，**不影响正确性**（内容寻址 + 回读比对保证幂等）。

### 3.2 Local 保留的语义

- key 格式与生成规则**完全不变**：`${sha256.slice(0,2)}/${sha256}`
- 路径越界校验、正则校验**完全不变**
- `SOURCE_FILE_IMMUTABILITY_VIOLATION` 语义**完全不变**

### 3.3 `FactSourceFileStorageService` 的 CFS 校验剥离

`onModuleInit()` 中的 `assertProductionFactSourceStorage()` 调用需在 D 阶段改为**仅当 adapter 选择为 local 时**才执行挂载校验；COS 模式下 local 实例不参与生产路径，不应因缺挂载而阻断启动。详见 §4.4。

---

## 4. COS adapter 设计

### 4.1 SDK 与客户端抽象

新增 `apps/api/src/facts/storage/cos-client.interface.ts` —— **不直接依赖 SDK 类型的最小端口**，使单元测试可注入伪实现（无凭据可测）：

```ts
export interface CosPutObjectParams {
  Key: string; Body: Buffer; ContentType?: string; ContentLength?: number;
}
export interface CosClientPort {
  putObject(p: CosPutObjectParams): Promise<{ ETag?: string; statusCode?: number }>;
  getObject(p: { Key: string }): Promise<{ Body: Buffer; statusCode?: number }>;
  headObject(p: { Key: string }): Promise<{
    ContentLength?: number; ContentType?: string; LastModified?: string; statusCode?: number;
  }>;
  deleteObject(p: { Key: string }): Promise<{ statusCode?: number }>;
}
export const COS_CLIENT = Symbol('COS_CLIENT');
```

`apps/api/src/facts/storage/cos-client.factory.ts` 负责把 `cos-nodejs-sdk-v5` 的回调式 API 适配为上述 Promise 端口，并注入 `Bucket`/`Region`（业务代码不再重复传）。**这是全仓库唯一 `import COS from 'cos-nodejs-sdk-v5'` 的文件。**

### 4.2 objectKey 生成规则：**沿用内容寻址 + 固定前缀**

```
objectKey = `${prefix}${sha256.slice(0, 2)}/${sha256}`
prefix    = COS_OBJECT_PREFIX，默认 'fact-source-files/'，必须以 '/' 结尾或为空
```

**但持久化到 MySQL 的 `source_file_storage_key` 仍只存 `${sha.slice(0,2)}/${sha}`（不含 prefix）。**

理由（这是本设计的关键决策，请勿在实现时改动）：
1. **零 DDL、零数据迁移**：`fact_import_batch.source_file_storage_key` 与 `import_job.source_file_storage_key` 中的历史值就是 `xx/<sha>` 格式；若把 prefix 存进去，历史行与新行格式不一致，`resolveKey()` 正则（`^[a-f0-9]{2}\/[a-f0-9]{64}$`）会对历史行报 `SOURCE_FILE_STORAGE_KEY_INVALID`。
2. **prefix 属于部署配置而非业务数据**，存进 DB 会导致换 bucket/换 prefix 时需要改数据。
3. Local 与 COS 两种 adapter 的 DB 值可互换，**回滚无需数据修复**。

因此：**接口层 `storageKey` = 逻辑键 `xx/<sha>`；COS adapter 内部做 `prefix + logicalKey ⇄ objectKey` 的双向映射**。逻辑键校验正则与 Local 共用同一个工具函数（新增 `assertLogicalStorageKey()`，从现有 `resolveKey()` 提取）。

### 4.3 私有对象保证（硬性）

1. `putObject` **不得**传 `ACL` 参数；桶级 ACL 保持私有（已核验 zy 环境默认「Only admin can read and write」）
2. **禁止**调用 `cos.getObjectUrl()`、**禁止**生成任何预签名 URL、**禁止**把 `Location`/`url` 字段返回给前端
3. 所有下载**必须**经 API 服务代理：客户端 → `GET /api/.../source-file`（带 JWT）→ 服务端 `storage.get()` → `StreamableFile`
4. 应由门禁静态断言：`apps/api/src` 与 `apps/admin-web/src` 中禁止出现 `getObjectUrl`、`getAuth(`、`myqcloud.com`、`cos.ap-` 等字面量（任务 D3）

### 4.4 配置模型

新增 `apps/api/src/facts/storage/fact-source-storage.config.ts` 的**同目录新文件**（保留旧 `facts/fact-source-storage.config.ts` 供 local 用）：

| 环境变量 | 必填条件 | 说明 |
|---|---|---|
| `FACT_SOURCE_STORAGE_DRIVER` | **production 必填** | 枚举 `local` \| `cos`。**显式开关，无隐式回退** |
| `COS_REGION` | driver=cos 时必填 | 如 `ap-shanghai` |
| `COS_BUCKET` | driver=cos 时必填 | 必须形如 `<name>-<appid>`，正则 `^[a-z0-9-]+-\d{5,}$` |
| `COS_SECRET_ID` | driver=cos 时必填 | **仅运行时注入** |
| `COS_SECRET_KEY` | driver=cos 时必填 | **仅运行时注入** |
| `COS_SESSION_TOKEN` | 可选 | 临时凭据（STS）时必填，见 §11 待决项 |
| `COS_OBJECT_PREFIX` | 可选 | 默认 `fact-source-files/` |
| `COS_REQUEST_TIMEOUT_MS` | 可选 | 默认 `30000` |
| `COS_MAX_RETRIES` | 可选 | 默认 `2`（即最多 3 次尝试） |
| `FACT_SOURCE_STORAGE_ROOT` | driver=local 时必填 | 仅 local 使用 |

**adapter 选择逻辑（禁止猜测式回退）**：
```
NODE_ENV=production:
  FACT_SOURCE_STORAGE_DRIVER 缺失      → 抛 FACT_SOURCE_STORAGE_DRIVER_REQUIRED（启动失败）
  = 'cos'   → 校验 COS_* 全套，缺任一 → 抛 COS_<NAME>_REQUIRED（启动失败）
  = 'local' → 沿用旧挂载校验（保留 CFS 语义，供极端回退）
  其他值    → 抛 FACT_SOURCE_STORAGE_DRIVER_INVALID
非 production:
  默认 'local'（显式声明的默认值，非静默回退），允许 'cos' 用于联调
```

**production + driver=cos 时，不再执行任何 `/mnt/fact-source-files` 挂载校验** —— 这是替代原 CFS 强制依赖的核心变更，同时需**同步移除** `runtime.config.ts:27-29` 的无条件 `FACT_SOURCE_STORAGE_ROOT_INVALID` 判定，改为"仅 driver=local 时校验"。

**密钥纪律（硬性）**：
- 密钥只经环境变量注入，**禁止**写入代码、`cloudbaserc.json`、`evidence/`、任何 Markdown、任何 Git 对象
- 日志脱敏：`COS_SECRET_ID` 只允许打印前 4 位 + `****`；`COS_SECRET_KEY` / `COS_SESSION_TOKEN` **一律不打印，连长度都不打印**
- 错误对象向上抛出前必须剥离 SDK 原始 error 中可能含凭据的 `headers.Authorization`（COS SDK 错误体可能带签名串）

### 4.5 SDK 调用、超时与重试

- 所有调用经 `CosClientPort`，统一包 `withTimeout(COS_REQUEST_TIMEOUT_MS)`
- 重试**仅对幂等操作**：`getObject` / `headObject` / `deleteObject` / `putObject`（内容寻址下 put 天然幂等，可安全重试）
- 重试条件：网络错误、超时、HTTP 5xx、429。**403/404 不重试**
- 退避：指数退避 `200ms * 2^n` + 全抖动，上限 `COS_MAX_RETRIES`

### 4.6 错误映射

| COS 侧 | 映射 | retryable |
|---|---|---|
| 404 / `NoSuchKey` | `SOURCE_FILE_NOT_FOUND` | false |
| 403 / `AccessDenied` / `SignatureDoesNotMatch` / `InvalidAccessKeyId` | `SOURCE_FILE_STORAGE_FORBIDDEN` | false |
| 5xx / 429 / `ECONNRESET` / `ETIMEDOUT` / 超时 | `SOURCE_FILE_STORAGE_UNAVAILABLE` | true |
| 配置缺失 | `SOURCE_FILE_STORAGE_CONFIG_INVALID` | false |

**HTTP 外泄约束**：以上错误码**不得**直接作为 HTTP body 返回给终端用户。`getSourceFile()` 现有行为（一律转 `NotFoundException` + 审计具体原因）**必须保留**，避免通过错误码差异探测对象存在性。

---

## 5. 幂等策略

### 5.1 对象层幂等：head-then-put

内容寻址下同一 sha256 必然映射同一 objectKey，故：

```
put(input):
  1. actualSha = sha256(buffer)；≠ expectedSha → SOURCE_FILE_HASH_MISMATCH
  2. meta = await head(logicalKey)
  3. meta 存在:
       3a. meta.size === buffer.length → 判定命中，返回 { deduplicated: true, ...meta }
       3b. meta.size !== buffer.length → SOURCE_FILE_IMMUTABILITY_VIOLATION（sha 相同但长度不同 = 异常）
  4. meta 不存在 → putObject（无 ACL）→ 返回 { deduplicated: false }
```

**为什么 head 先探测而不是直接 put**：
- COS 的 `putObject` 无 `wx`（exclusive create）语义，直接 put 会**静默覆盖**，丢失 Local 的 `EEXIST → 回读比对` 不可变性保护
- head 是廉价调用（不传输正文），对大 Excel 文件可显著省流量与时间
- head 的竞态窗口无害：两个并发请求同 sha 都 miss → 都 put → 写入内容逐字节相同，最终状态一致

**完整性兜底**：`put` 之后**不做**额外的读回校验（成本高）；完整性由**读路径**保证 —— `getSourceFile()` 已有 `hash(buffer) !== batch.fileSha256 → integrity_failed` 校验（`fact-import.service.ts:598-601`），该校验**必须保留**，它是 COS 场景下防静默损坏的最后一道闸。

### 5.2 业务层幂等：依赖既有唯一索引，不新增

`uk_fact_batch_city_kind_hash (city_id, fact_kind, source_file_sha256)` 已保证同城市同类型同哈希只有一行批次。现有 `completedBatch(cityId, kind, hash)` 命中即走 `ensureEvidence()` 幂等返回（`fact-import.service.ts:129-133`）。**本轮不改该逻辑**，仅需保证 `ensureEvidence()` 中的 `exists()` 走新接口。

---

## 6. 补偿策略（COS 成功 + MySQL 失败）

### 6.1 现状风险

实测 `fact-import.service.ts:95` 与 `:128`：`store()` 在 `this.dataSource.transaction(...)` **之外、之前**执行。Local 盘下孤儿文件无害（内容寻址、可去重、成本近零）；**COS 下孤儿对象产生真实存储成本且无回收机制**。

### 6.2 时序（硬性）

```
1. 计算 sha256
2. storage.put()                     ← 对象先落定
3. BEGIN TRANSACTION
4.   写 fact_import_batch / fact_source_row / facts / fact_version / operation_log
5. COMMIT
6. 失败(4/5 抛错) → 进入补偿
```

**「COS 成功后才写成功元数据」的具体含义**：`sourceFileStorageKey` / `sourceFileSize` / `sourceFileStoredAt` 三个字段只有在 `put()` resolve 之后才被赋值（现状已如此，`evidence` 对象来自 `put` 返回值）。**禁止**先写 DB 占位再补 key。

### 6.3 补偿规则（关键：并非无条件删除）

```
onTransactionFailure(evidence):
  if (evidence.deduplicated === true):
      # 对象在本次请求之前就存在，可能被其它批次引用
      # → 绝对不删除。仅记日志。
      return
  if (evidence.deduplicated === false):
      # 本次请求首次创建
      try:
          await storage.delete(evidence.storageKey)   # 幂等删除
          log(level=warn, code='SOURCE_FILE_COMPENSATION_DELETED')
      catch (e):
          # 补偿本身失败 → 留孤儿清理标记
          log(level=error, code='SOURCE_FILE_ORPHAN_OBJECT',
              payload={ storageKey, sha256, size, reason: e.code })
          # 不向上抛：补偿失败不得掩盖原始业务错误
```

**`deduplicated` 字段存在的唯一理由就是这条规则** —— 没有它就无法区分"我创建的"和"别人的"，无条件删除会误删其它批次仍在引用的对象。

### 6.4 孤儿对象清理

- 补偿失败时写 `operation_log`：`action_type='fact_source_object_orphaned'`、`result_status='failed'`、`after_data_json={ storageKey, sha256, size }`
- 提供只读盘点脚本 `scripts/oneoff/list-orphan-cos-objects.mjs`（任务 D5）：比对 COS 对象清单与 DB 中 `source_file_storage_key` 集合，输出差集报告
- **该脚本只输出报告，不执行删除**。实际删除需人工复核后单独执行，避免误删

---

## 7. 回滚策略

### 7.1 硬性禁令

**禁止** `git reset --hard`、`git checkout -- <path>`、`git push --force`、切换分支、删除未知文件。
原因：恢复工作区 `E:/code2/biz-reporting-system-recovery` 是 `E:/code2/biz-reporting-system-fix` 的 **git worktree，共享同一 `.git` 数据库**，破坏性操作会同时损坏已冻结的旧工作区。

### 7.2 回滚等级

**L0 — 配置回滚（首选，秒级，不改代码不发版）**

前提：D 阶段完成后 `local` driver 仍完整保留。
```
1. 将运行环境变量 FACT_SOURCE_STORAGE_DRIVER 由 cos 改回 local
2. 补齐 FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files 与持久挂载
3. 重启服务，验证 GET /api/health/ready → checks.storage === 'up'
```
局限：切回 local 后，**COS 期间新上传的对象在本地盘不存在**，其对应批次的源文件下载会走 `source_file_missing` 分支（返回 404 + 审计），**业务元数据不丢失**。这是 L0 的已知代价，必须在切换前向上游明示。

**L1 — 代码回滚（revert，前进式）**
```
git log --oneline 286d338..HEAD          # 列出本轮全部提交
git revert --no-commit <c_n> ... <c_1>   # 逆序 revert，全部暂存
git commit -m "revert: roll back COS SDK direct storage to 286d338"
```
- 使用 `--no-commit` 批量暂存后单次提交，避免产生大量 revert 提交
- 若存在合并提交，使用 `git revert -m 1 <merge>`
- **不使用** `git reset`；历史保持前进

**L2 — 精确文件级回滚（只回退部分文件，不用 checkout --）**
```
git show 286d338:<path> > <path>     # 用重定向写回，而非 checkout --
git add <path>
git commit -m "revert: restore <path> to 286d338 baseline"
```

### 7.3 回滚后验证（三项必过）

```
1. git log --oneline -3              # 确认回滚提交在顶部，286d338 仍在历史中
2. git status --porcelain=v1         # 确认既有治理产物（cloudbaserc.json / evidence/ /
                                     #   workspace-recovery-*）状态与回滚前一致，未被清理
3. pnpm test:storage-gate && pnpm test:unit && pnpm test:architecture
                                     # 门禁全绿
```
额外：`git diff 286d338 -- apps/ packages/ Dockerfile package.json pnpm-lock.yaml` 应为空（若目标是完全回到基线）。

---

## 8. 失败与状态机

### 8.1 硬性原则

**导入失败不得留下任何"成功"状态。** 具体到实体：

`fact_import_batch`：

| 场景 | `status` | `lifecycle_status` | `completed_at` | `effective_at` | `source_file_storage_key` |
|---|---|---|---|---|---|
| 校验阻塞失败 | `failed` | `validation_failed` | 置当前时间 | **`null`** | 已写（证据保留） |
| 解析失败（不可解析） | `failed` | `validation_failed` | 置当前时间 | **`null`** | 已写（证据保留） |
| 处理中 | `processing` | `processing` | `null` | `null` | 已写 |
| 成功 | `completed` | `current_effective` / `effective_with_warning` | 置时间 | 置时间 | 已写 |
| **COS put 失败** | **不创建批次行** | — | — | — | — |
| **COS 成功 + 事务失败** | **不创建批次行**（事务回滚）+ 触发 §6.3 补偿 | — | — | — | — |

**新增约束**：`effective_at != null` ⟺ `status='completed'`。任何失败路径都**不得**写 `effective_at`。现有实现已满足（`fact-import.service.ts:181`、`:310` 失败时显式 `effectiveAt: null`），**C 阶段改造不得破坏**。

`fact_source_row.status`：`invalid` / `warning` / `valid` → 成功后 `update({importBatchId}, {status:'written'})`（@239）。失败路径不得置 `written`。

`import_job`（WS6）：`ws6.service.ts:113-128` 现状为"store 失败则抛错、不创建 job"，符合原则，**C 阶段保持**。注意 `createImportJob` 中 `store()` 在 `importJobRepo.save()` 之前，同样需要 §6.3 补偿包裹。

### 8.2 状态流转图

```
          upload
            │
            ▼
      [put to COS]
       ├─ 失败 ─────────────────► 无批次行 + 4xx/5xx（不留成功痕迹）
       └─ 成功 (evidence)
            │
            ▼
      [BEGIN TX]
       ├─ 校验阻塞 ──► status=failed, lifecycle=validation_failed, effective_at=NULL ──► COMMIT
       ├─ 解析异常 ──► status=failed, lifecycle=validation_failed, effective_at=NULL ──► COMMIT
       ├─ 写库异常 ──► ROLLBACK ──► §6.3 补偿（deduplicated=false 才删对象）
       └─ 正常 ─────► status=completed, lifecycle=current_effective|effective_with_warning,
                       effective_at=now ──► COMMIT
```

> 注：校验阻塞/解析失败属于**业务预期失败**，事务需 COMMIT 以持久化失败证据（现状如此），此时对象**保留不删**（它是失败证据的一部分）。仅"写库异常导致 ROLLBACK"才触发对象补偿删除。

---

## 9. 鉴权约束

### 9.1 落点

三个下载端点必须全部处于鉴权之下：

| 端点 | 文件 | 现状 | 要求 |
|---|---|---|---|
| `GET /api/imports/:jobId/source-file` | `ws6/imports.controller.ts:40` | 类级 `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(SYSTEM_ADMIN, CITY_USER)`（L18-19），**已核验合规** | 保持 |
| `.../import-batches/:id/source-file` | `admin-facts.controller.ts:33` | 守卫在类级装饰器，**本次未逐行核验类头** | C 阶段须核验并确保 `JwtAuthGuard` 覆盖 |
| `.../import-batches/:id/source-file` | `city-facts.controller.ts:65` | 同上 | C 阶段须核验并确保 `JwtAuthGuard` + 城市 scope |

> 诚实声明：`admin-facts.controller.ts` 与 `city-facts.controller.ts` 的类级守卫装饰器本轮**未逐行读取**，仅确认了端点行号。任务 C4 已列为必做核验项，不得默认合规。

### 9.2 行为要求

- 无 token / token 无效 → **401**（`JwtAuthGuard` 默认行为）
- 有 token 但角色不符 → **403**（`RolesGuard`）
- 有 token、角色符合，但访问他城市批次 → **404**（`NotFoundException`，**故意不用 403**，避免存在性探测）——现状 `fact-import.service.ts:579-582` 已如此，保留
- 响应头 `Cache-Control: no-store` —— `imports.controller.ts:41` 已有，另两个端点须核验
- **任何情况下响应体不得包含 objectKey、bucket、region、COS 域名**

### 9.3 与 COS 的关系

COS 桶私有 + 无预签名 URL ⇒ **鉴权唯一入口是 API 服务**，不存在绕过 API 直取对象的路径。这是 §4.3 禁令的安全依据。

---

## 10. 门禁与测试影响面（D/E 阶段必须同步）

| 门禁 | 现状断言 | 去 CFS 后 | 处理 |
|---|---|---|---|
| `scripts/test/check-fact-storage-gate.mjs` | 断言 CFS 挂载四连（含 `fuse.cosfs` 样例） | **必然失败** | 改写为 driver 选择 + COS 配置校验门禁 |
| `scripts/test/check-container-runtime.mjs:44-45` | 断言 Dockerfile 保留 `required-persistent-mount` + `FACT_SOURCE_STORAGE_ROOT=/mnt/...` | **必然失败** | 改断言为 driver=cos 下不含 CFS 标签；保留 UID 10001/healthcheck/双 Dockerfile 一致性断言 |
| `check-container-runtime.mjs:32` | 根 Dockerfile ≡ `apps/api/Dockerfile` | 仍需成立 | **两个 Dockerfile 必须同步修改** |
| `scripts/test/check-production-runtime-config.mjs:30` | 传 `/mnt/fact-source-files` | 需补 driver/COS 变量 | 更新样例环境 |
| `scripts/test/run-deployment-preflight.mjs:36` | 同上 | 同上 | 更新 |
| `scripts/test/i1-manifest.json:57` | `requiredEnvironment: ["FACT_SOURCE_STORAGE_ROOT"]` | 需改 | 改为 driver 相关变量 |
| `apps/api/test/import-job-storage.integration.mjs` | 无参 `new FactSourceFileStorageService()` | 保持可用 | **不得破坏**（见 §3.1） |
| `scripts/architecture/check-dependencies.mjs` | 无存储相关规则 | — | **新增** §2.4 三条依赖方向规则 |

---

## 11. 风险与待上游拍板事项

| # | 事项 | 说明 | 影响 | 状态 |
|---|---|---|---|---|
| **R1** | **临时凭据 vs 长期凭据（最高优先级）** | 已核验：`tcb secrets` **只有 `get`**，返回的是**当前登录会话的临时凭据（有时效）**，不是长期运行服务的密钥注入设施。长期运行的 CloudRun 服务需要：(a) 长期 SecretId/SecretKey 经环境变量注入；或 (b) STS 临时凭据 + 服务内定时刷新 + `COS_SESSION_TOKEN`。两者实现复杂度差异显著（(b) 需额外的凭据刷新器与过期重试逻辑） | 决定 `CosClientPort` 是否需要凭据刷新能力；决定 D 阶段工作量 | **待上游拍板** |
| **R2** | 无真实凭据 ⇒ F 阶段 BLOCKED | 本机 `COS_SECRET_ID/KEY/BUCKET/REGION/JWT_SECRET` 全部 UNSET（已核验） | A~E 不受阻（Local + 伪 COS 客户端可测）；F 阶段需凭据 | 已知，设计已适配 |
| **R3** | L0 回滚的数据可见性缺口 | 切回 local 后 COS 期新对象在本地盘不存在，下载走 404（元数据不丢） | 需上游确认可接受 | **待确认** |
| **R4** | `deduplicated` 判定的 TOCTOU | 并发同 sha 时可能都判 `false`，补偿时可能重复删同一对象 | 删除幂等（ENOENT 静默），无实际损害；但极端情况下 A 的补偿可能删掉 B 刚提交成功所引用的对象 | **残留风险**，建议 R4 缓解：补偿删除前再查一次 DB 是否仍有行引用该 sha256，有则不删 |
| **R5** | 桶生命周期与保留期 | `getSourceFile()` 有"已超出保留期"文案（@589），但未核验是否存在实际保留策略实现 | 若配 COS 生命周期规则删除对象，需与业务保留期对齐 | **待明确** |
| **R6** | 大文件内存占用 | 现状 `put(buffer)` / `get() → Buffer` 全量进内存，multer 亦为内存存储 | COS SDK 支持流式，但改流式会扩大改动面 | 本轮**不改**，维持 Buffer 语义；列为后续优化 |
| **R7** | `admin-facts` / `city-facts` 守卫未逐行核验 | 见 §9.1 诚实声明 | C4 任务必做核验 | **待核验** |
| **R8** | 产品经理并行结论未到 | 许清楚的「specs 三件套与 COS 方案冲突识别」结论尚未转交 | 可能要求修订本文 | 已知，按团队长指示先行推进 |

---

## 12. 设计不变量（实现时逐条自检）

1. 业务层零 `fs`、零 `cos-nodejs-sdk-v5` 直接依赖
2. DB 中 `source_file_storage_key` 恒为 `xx/<sha256>`，**不含 prefix**
3. 不生成任何公开/预签名 URL；`putObject` 不带 `ACL`
4. 密钥不入代码/日志/证据/Git；SecretKey 与 SessionToken 一律不打印
5. 失败路径 `effective_at` 恒为 `null`
6. 仅 `deduplicated === false` 的对象才允许补偿删除
7. 读路径 sha256 完整性校验保留
8. 越权访问返回 404 而非 403
9. Local adapter 始终可用（无凭据可跑全部单测）
10. 根 Dockerfile 与 `apps/api/Dockerfile` 保持一致
</content>
