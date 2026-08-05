# COS SDK 直连存储架构设计（冻结版）

- 文档状态：**A 阶段冻结**，B/C/D 阶段实现必须遵循本文
- 分支：`fix/i1-typeorm-migration-storage`
- 基线提交：`286d338bc1f996ef0c1af2d2c47b8b3199d2fa21`（fix: add typeorm metadata migration）
- 上游已拍板方案：**COS 对象存储 + 后端 COS Node.js SDK 直连**（不使用 CFS，不使用 MySQL BLOB）
- 作者：架构师
- 语言约定：正文简体中文，代码标识符/接口签名英文

## 修订记录

| 版本 | 变更 |
|---|---|
| v1（17bf683） | 初版冻结 |
| **v2（本次）** | 依据团队长对「架构设计 ↔ PM 规格对齐报告」四处冲突的裁决做定向修订：①撤销 `FACT_SOURCE_STORAGE` Symbol，收敛为单一注入点 + 内部 driver；②COS driver 探针禁止真实写入；③明确本轮零 DDL 边界，`contentType` 不入库、业务幂等走应用层；④登记两处制度冲突。另补全门禁落点、映射 PM 的 29 项验收子项、登记 ACL 缺口。 |

> **依据文件**：`evidence/governance/COS-SDK-DIRECT-I1-REQUIREMENTS-ALIGNMENT.md`（PM 规格对齐报告，508 行）
>
> **条文出处核验（本轮实读）**：
> - PM 编号 DES-20 = `specs/production-governance-20260802/design.md:905`「WS6 使用已有持久存储服务，不新建第二套文件系统抽象。」— **已逐字核验**
> - D-01 禁止项 = `specs/production-governance-20260802/tasks.md:385`「禁止：新存储抽象、公开 URL、清空旧 Base64。」— **已逐字核验**
> - PM 编号 DES-05 的表述「保留同一注入点与接口签名…不新增第二个注入符号」：**在 `design.md` 中未检索到该逐字原文**（`grep "注入符号|同一注入点|替换内部实现"` 命中 0）。`DES-xx` 系 PM 报告的自建编号，非 specs 正文内联标识。裁决 1 的规范依据以上述两条**已逐字核验**的条文为准；后续引用请勿把 DES-05 当作 specs 正文原文引述。

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

## 2. 存储契约定义（单一注入点 + 内部 driver）

### 2.0 裁决 1：撤销第二注入符号

**v1 的 `export const FACT_SOURCE_STORAGE = Symbol(...)` 已撤销。** 它构成 specs 明令禁止的"第二个注入符号 / 新存储抽象"（依据见开篇修订记录中已逐字核验的 `design.md:905`、`tasks.md:385`）。

**修订后形态**：`FactSourceFileStorageService` 保持为**唯一 Nest 注入点与唯一类名**，Local/COS 差异下沉为该类**内部持有的 driver**：

```ts
// 内部实现细节：不是 Nest provider，不导出为注入令牌
export interface FactSourceDriver {
  put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile>;
  get(storageKey: string): Promise<Buffer>;
  head(storageKey: string): Promise<FactSourceObjectMeta | null>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;   // 仅补偿/运维
  assertReadable(): Promise<void>;
  assertWritable(): Promise<void>;
}

@Injectable()
export class FactSourceFileStorageService implements OnModuleInit {
  private readonly driver: FactSourceDriver;
  /** driver 为可选参数：省略时按 env 解析。保证既有无参 new 可用。 */
  constructor(driver?: FactSourceDriver) {
    this.driver = driver ?? resolveDriverFromEnv(process.env);
  }
  // 既有公开方法签名全部不变，内部转调 this.driver
  async store(buffer: Buffer, originalName: string, expectedSha256: string): Promise<StoredFactSourceFile>
  async read(storageKey: string): Promise<Buffer>
  async exists(storageKey: string): Promise<boolean>
  async assertReadable(): Promise<void>
  async assertWritable(): Promise<void>
  async assertReady(): Promise<void>   // @deprecated 别名保留
}
```

该形态同时满足四点：
1. **不新增注入符号** —— 满足 `design.md:905` / `tasks.md:385` 字面约束
2. **`new FactSourceFileStorageService()` 无参构造仍可用** —— `apps/api/test/import-job-storage.integration.mjs:67` 不被打断（driver 为**可选**参数是关键）
3. **`facts.module.ts:30-31` providers/exports 不变**，三个消费方（`app.service.ts:36`、`fact-import.service.ts:83`、`ws6.service.ts:98`）构造注入签名**全部不变** —— C 阶段改动面大幅收窄
4. **Local/COS 可切换**，且无论上游对 Q-04 如何裁定，代码都不返工

> **对 C 阶段的连带影响（重要）**：由于注入签名不变，v1 中 C1/C2/C3 的"改注入"工作量消失，C 阶段只剩"新增补偿逻辑"与"鉴权核验"。任务文档已同步收窄。

### 2.1 设计目标

1. 业务层（`FactImportService` / `Ws6Service` / `AppService`）只依赖 `FactSourceFileStorageService` 的**既有公开方法**，不依赖 `fs`、不依赖 `cos-nodejs-sdk-v5`
2. driver 契约语义为**内容寻址不可变对象存储**，Local 与 COS 两种实现语义等价
3. 无真实 COS 凭据时，Local driver + 可注入伪 COS 客户端即可跑通全部单元测试（F 阶段 BLOCKED 不阻塞 A~E）

### 2.2 类型文件

新增 `apps/api/src/facts/storage/fact-source-driver.interface.ts`：

```ts
/** 存储对象的元数据（不含正文） */
export interface FactSourceObjectMeta {
  /** 内容寻址键，格式恒为 `${sha256.slice(0,2)}/${sha256}` */
  storageKey: string;
  /** 字节数 */
  size: number;
  /** 内容 SHA-256（小写 hex，64 位） */
  sha256: string;
  /**
   * MIME 类型；未知时为 'application/octet-stream'。
   * ⚠️ 裁决 3：本轮**仅作为返回值与 COS 对象的 Content-Type header 使用，不入库**。
   * 009 迁移无该列，入库需 010 迁移（独立待授权任务，见 §5.3 与 §11 R9）。
   */
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

/**
 * 内部 driver 契约。**不是 Nest provider，不导出注入令牌。**
 * 唯一注入点仍为 FactSourceFileStorageService（见 §2.0）。
 */
export interface FactSourceDriver {
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

  /**
   * 只读健康探针（readiness 用）。失败抛错。
   * ⚠️ 裁决 2：COS driver 实现**必须为纯只读**（headBucket），
   *    禁止 PutObject/DeleteObject。见 §4.7。
   */
  assertReadable(): Promise<void>;

  /**
   * 启动时一次性探针。失败抛错。
   * ⚠️ 裁决 2：COS driver 实现**同样禁止真实写入**，见 §4.7。
   *    仅 Local driver 保留写探针文件语义。
   */
  assertWritable(): Promise<void>;
}
```

> **v1 → v2 差异提示**：v1 此处名为 `FactSourceStorage` 并附带 `export const FACT_SOURCE_STORAGE = Symbol(...)`。**该 Symbol 已删除**，接口更名为 `FactSourceDriver` 以在命名上明确其"内部实现契约"身份。方法集本身未变。

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
                   ▼  只依赖（注入签名不变）
      FactSourceFileStorageService  ← 唯一 Nest 注入点 / 唯一类名
                   │  内部持有（非 provider）
                   ▼
            FactSourceDriver（interface，无任何 IO 依赖）
                   ▲  实现
        ┌──────────┴──────────┐
LocalFactSourceDriver     CosFactSourceDriver
   (node:fs)                (cos-nodejs-sdk-v5)
```

规则（应由 `scripts/architecture/check-dependencies.mjs` 新增规则强制，见任务 D3）：
- `apps/api/src/**` 中，除 `apps/api/src/facts/storage/local-fact-source-driver.ts` 外，**任何文件不得** `import ... from 'node:fs'` / `'fs'` / `'node:fs/promises'` 用于源文件正文读写
- `apps/api/src/**` 中，除 `apps/api/src/facts/storage/cos-client.factory.ts` 外，**任何文件不得** `import ... from 'cos-nodejs-sdk-v5'`
- **禁止**出现除 `FactSourceFileStorageService` 之外的任何存储类 Nest provider / 注入令牌；**禁止**业务服务直接引用 `LocalFactSourceDriver` / `CosFactSourceDriver` 具体类
- **禁止**新增 `Symbol('FACT_SOURCE_STORAGE')` 之类的存储注入令牌（裁决 1 的门禁化，见任务 D3 的 `AR-R7-d`）

---

## 3. Local driver 设计

### 3.1 与现有 `FactSourceFileStorageService` 的关系：**逻辑内移，类保留**

**决策（v2 依裁决 1 修订）：现有 `fs` 内容寻址逻辑原样迁入 `LocalFactSourceDriver`；`FactSourceFileStorageService` 类名、公开方法签名、Nest provider 身份全部保留，内部改为转调 driver。**

> v1 曾设计为"新增 `LocalFactSourceStorage` 包装类 + 新注入符号"。**该形态已撤销**——它引入了第二个注入符号。v2 改为逻辑内移，`FactSourceFileStorageService` 仍是唯一注入点。

理由（基于实测约束，非偏好）：
1. `apps/api/test/import-job-storage.integration.mjs:67` 无参 `new FactSourceFileStorageService()`。**driver 必须是可选构造参数**，否则该测试直接崩。
2. 现有内容寻址 + `wx` 原子写 + EEXIST 回读比对逻辑已通过既有门禁，**原样迁移，不重写**。
3. E 阶段需要一个不依赖任何云凭据的可用实现，Local 必须始终可跑。

具体形态 —— 新增 `apps/api/src/facts/storage/local-fact-source-driver.ts`：

```ts
export class LocalFactSourceDriver implements FactSourceDriver {
  constructor(private readonly root: string) {}   // 普通类，非 @Injectable

  async put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile>
  async get(key: string): Promise<Buffer>            // readFile + ENOENT→NOT_FOUND 映射
  async head(key: string): Promise<FactSourceObjectMeta | null>   // stat
  async exists(key: string): Promise<boolean>
  async delete(key: string): Promise<void>           // unlink，ENOENT 静默
  async assertReadable(): Promise<void>              // access(root, R_OK)
  async assertWritable(): Promise<void>              // 写探针文件后删除（Local 保留此语义）
}
```

迁移映射（逐方法，来源为现 `fact-source-file-storage.service.ts`）：

| driver 方法 | 迁移自 | 语义变化 |
|---|---|---|
| `put()` | `store()` @52-74 | 仅增加 `deduplicated` 判定与 `sha256`/`contentType` 返回字段 |
| `get()` | `read()` @76-78 | 增加 ENOENT → `SOURCE_FILE_NOT_FOUND` 映射 |
| `exists()` | `exists()` @80-87 | 无变化 |
| `assertReadable()` | `assertReadable()` @29-31 | 无变化 |
| `assertWritable()` | `assertWritable()` @34-45 | 无变化（**Local 保留写探针**） |
| 内部 `resolveKey()` | `resolveKey()` @89-98 | 提取正则到共享工具，逻辑不变 |
| `head()` / `delete()` | 新增 | — |

`put()` 的 `deduplicated` 判定：先 `exists(key)`，为真则 `deduplicated = true` 且跳过写入（EEXIST 回读比对分支保留，语义安全）；为假则写入后置 `deduplicated = false`。TOCTOU 竞态时退化为 `deduplicated = false`，**不影响正确性**（内容寻址 + 回读比对保证幂等），补偿侧的残留风险见 §6.5。

### 3.2 Local 保留的语义

- key 格式与生成规则**完全不变**：`${sha256.slice(0,2)}/${sha256}`
- 路径越界校验、正则校验**完全不变**
- `SOURCE_FILE_IMMUTABILITY_VIOLATION` 语义**完全不变**

### 3.3 `FactSourceFileStorageService` 的 CFS 校验剥离

`onModuleInit()` 中的 `assertProductionFactSourceStorage()` 调用需在 D 阶段改为**仅当 driver 为 local 时**才执行挂载校验；driver=cos 时不构造 Local driver、不读 mountinfo、不做挂载断言。详见 §4.4。

---

## 4. COS driver 设计

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
  /** 裁决 2：健康探针专用。只读、零对象产生。 */
  headBucket(): Promise<{ statusCode?: number }>;
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
3. Local 与 COS 两种 driver（Local/COS）的 DB 值可互换，**回滚无需数据修复**。

因此：**接口层 `storageKey` = 逻辑键 `xx/<sha>`；COS driver 内部做 `prefix + logicalKey ⇄ objectKey` 的双向映射**。逻辑键校验正则与 Local 共用同一个工具函数（新增 `assertLogicalStorageKey()`，从现有 `resolveKey()` 提取）。

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
| `COS_SESSION_TOKEN` | 可选 | STS 临时凭据形态必填；已裁定 R1=STS 刷新（Codex PG-20260805） |
| `COS_OBJECT_PREFIX` | 可选 | 默认 `fact-source-files/` |
| `COS_REQUEST_TIMEOUT_MS` | 可选 | 默认 `30000` |
| `COS_MAX_RETRIES` | 可选 | 默认 `2`（即最多 3 次尝试） |
| `FACT_SOURCE_STORAGE_ROOT` | driver=local 时必填 | 仅 local 使用 |

**driver 选择逻辑（禁止猜测式回退）**：
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

### 4.7 健康探针：COS driver 禁止任何写操作（裁决 2）

**冲突事实**：现有 `assertReadable()` 语义是 POSIX `access(root, R_OK)`（`fact-source-file-storage.service.ts:29-31`），`assertWritable()` 是"创建+删除探针文件"（@34-45）。COS 无 `R_OK` 概念；若把 `assertWritable()` 直译为 `PutObject`，会在私有生产桶持续产生垃圾对象。且 `requirements.md` REQ-15 要求 ready 不得执行破坏性写探针，而 `app.service.ts:114` 的 readiness 正是调 `assertReadable()`。

**裁决落地**：

| 方法 | Local driver | **COS driver** |
|---|---|---|
| `assertReadable()` | `access(root, R_OK)`（不变） | **`headBucket()`，2 秒超时。只读、零对象产生** |
| `assertWritable()` | 写探针文件后删除（不变） | **`headBucket()` + 凭据/权限校验。禁止 `PutObject`、禁止 `DeleteObject`**，且仅启动时执行一次 |

**硬性禁令（写死，实现不得偏离）**：

> **`/ready` 路径不得对 COS 产生任何写操作。**
> 具体：`AppService.getReadiness()` → `assertReadable()` → COS driver 的调用链中，**只允许出现 `headBucket`**。禁止 `putObject`、`deleteObject`、`getObject`。
> 启动期 `assertWritable()` 同样禁止 `putObject` / `deleteObject`。
> 即"COS 桶中永远不会因健康检查而出现任何对象"。

**探针结果映射（保持 `app.service.ts` 下游断言不漂移）**：
- `headBucket` 成功 → `storage: 'up'`
- 超时（2 秒） → `storage: 'timeout'`
- 403 / 网络错误 / 5xx → `storage: 'dependency_error'`

`app.service.ts:100-103` 的 `toState()` 逻辑与 `READINESS_TIMEOUT_MS = 2000` **无需改动**，稳定依赖码字符串 `up` / `timeout` / `dependency_error` **保持不变**（对应 PM 编号 DES-12，避免下游断言漂移）。

> 注：`headBucket` 对**不存在的桶**返回 404、对**无权限**返回 403，二者均映射 `dependency_error`，不作区分——避免通过 readiness 响应探测桶是否存在。响应体不含 bucket/region/密钥（§9.2）。

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

### 5.2 业务层幂等：facts 侧有唯一索引，ws6 侧走应用层（裁决 3）

**两条路径的保障强度不同，必须分别论述。**

**(a) facts 侧 —— 有数据库级保障，本轮不改**
`uk_fact_batch_city_kind_hash (city_id, fact_kind, source_file_sha256)` 是**唯一**索引（已核验 `fact-import-batch.entity.ts:4`），保证同城市同类型同哈希只有一行批次。现有 `completedBatch(cityId, kind, hash)` 命中即走 `ensureEvidence()` 幂等返回（`fact-import.service.ts:129-133`）。**本轮不改该逻辑。**

**(b) ws6 / `import_jobs` 侧 —— 无数据库级保障，本轮走应用层**
PM 查证：009 迁移中 `idx_import_jobs_storage_key` 是**非唯一**索引，`import_jobs` 表**无任何业务幂等唯一约束**。因此 C-3.3（"同一幂等键重复提交只产生 1 条记录"）当前无数据库兜底。

本轮实现（应用层）：`Ws6Service.createImportJob()` 在 `repo.save()` 之前，按 **sha256 + 业务键**（`jobType` + `operatorUserId` + `cityId` + `reportYear`）查询既有 job；命中则**返回同一 jobId**（幂等成功语义），不创建新行、不报错。

> ⚠️ **已知残留风险（本轮接受，须登记）**：应用层"先查后写"在**极端并发**下存在竞态窗口——两个并发同幂等键请求可能都查不到、都插入，产生重复 job 行。数据库层无唯一约束可兜底。
> 该窗口与 §5.1 对象层的 TOCTOU 是**同源问题的两个层面**：对象层因内容寻址而无害（最终内容一致），**业务层则会真实产生重复行**。合并论述见 §11 R4。
> 彻底消除需 010 迁移添加唯一约束 —— 见 §5.3，**不在本轮范围**。

### 5.3 DDL 边界：本轮零 DDL（裁决 3）

**本轮明确不新增任何迁移文件、不修改任何既有迁移。** 具体：

| 项 | 本轮处置 | 理由 |
|---|---|---|
| `contentType` 落库 | **不入库**。仅作为 `put()` 返回值与 COS 对象的 `Content-Type` header | 009 无该列；入库需 DDL |
| `import_jobs` 业务幂等唯一约束 | **不新增**。走应用层查重（§5.2b） | 需 DDL |
| `source_file_storage_key` 列宽 | 无需改动 | 现为 `varchar(500)`，逻辑键仅 67 字符 |

**独立待授权任务（写入文档，不进本轮实现范围）**：
> **T-010-MIGRATION**：新增 010 迁移，添加 (1) `import_jobs.content_type` 列；(2) `import_jobs` 业务幂等唯一约束（建议 `jobType + operatorUserId + cityId + reportYear + sha256`），只加不删。
> **状态：PENDING —— 需上游授权后方可实施。** 依据：该任务触碰"已冻结迁移"的边界（009 是否已冻结未定），对应 PM 的 Q-03。

**与 PM 验收项 C-1.4 的冲突（必须显式登记）**：
PM 的 C-1.4 要求"元数据字段齐全：`objectKey`、`sha256`、`size`、**`contentType`**、业务关联、状态**全部落库**"。裁决 3 判定 `contentType` 本轮不入库，二者**直接冲突**。
本轮处置：**C-1.4 的 `contentType` 子项降级为"不适用（本轮）"**，其余 5 个字段的落库断言照常执行。该子项在 T-010-MIGRATION 获授权并实施后恢复。此降级须在 E 阶段验收报告中显式标注，不得静默跳过。

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
      # 本次请求首次创建。删前必须复查引用（裁决 4a 的豁免前提之一）
      stillReferenced = await anyRowReferences(evidence.sha256)
        # 查 fact_import_batch.source_file_sha256
        #  ∪ import_jobs.source_file_sha256 / source_file_storage_key
      if (stillReferenced):
          log(level=warn, code='SOURCE_FILE_COMPENSATION_SKIPPED_STILL_REFERENCED')
          return                                  # 不删
      try:
          await driver.delete(evidence.storageKey)   # 幂等删除
          log(level=warn, code='SOURCE_FILE_COMPENSATION_DELETED')
      catch (e):
          # 补偿本身失败 → 留孤儿清理标记
          log(level=error, code='SOURCE_FILE_ORPHAN_OBJECT',
              payload={ storageKey, sha256, size, reason: e.code })
          # 不向上抛：补偿失败不得掩盖原始业务错误
```

**`deduplicated` 字段存在的唯一理由就是这条规则** —— 没有它就无法区分"我创建的"和"别人的"，无条件删除会误删其它批次仍在引用的对象。**删前复查 DB 引用**是 v2 依裁决 4a 新增的第二道保险（同时也是 R4 竞态的缓解措施，见 §11 R4）。

### 6.5 ⚠️ 制度冲突登记（裁决 4a）：删除生产对象

**冲突事实（字面直接冲突，不是解释分歧）**：

| 来源 | 条文 |
|---|---|
| `specs/production-governance-20260802/tasks.md` §0.4 全局禁止事项 | **"禁止删除生产对象"** |
| 本轮 C 阶段硬约束 | "MySQL 写入失败时**删除**已上传的 COS 对象"（补偿） |

**处置（依团队长裁决）**：代码**照常实现**补偿删除，但删除权限被严格限定为以下**三个条件同时成立**：
1. 该对象是**本请求刚 Put** 的（`deduplicated === false`）
2. 删前复查 DB，**无任何行引用**该 sha256
3. 仅在 MySQL 元数据写入失败的补偿路径触发；业务正常流程、运维脚本一律禁止调用 `delete()`

**状态：DECIDED_COMPENSATION_REQUIRED（Codex PG-20260805 Q-02 已裁定：不豁免，补偿删除为必需实现）。** 对应 PM 的 Q-02 与验收项 C-2.5。

> 允许补偿删除的完整条件（四者全成立）：①本次请求首次创建（`deduplicated=false`）；②删除前数据库无引用；③MySQL 写入/事务异常触发；④非普通业务删除、非运维批量删除。生产实际部署与执行仍需后续发布授权。

### 6.4 孤儿对象清理

- 补偿失败时写 `operation_log`：`action_type='fact_source_object_orphaned'`、`result_status='failed'`、`after_data_json={ storageKey, sha256, size }`
- 提供只读盘点脚本 `scripts/oneoff/list-orphan-operation-log.mjs`（任务 D5）：**orphan operation-log 离线盘点**（仅基于 operation_logs 补偿标记，未核对真实 COS 桶；真实 COS 对账需 F 阶段桶与 STS 凭据就绪后执行），输出差集报告供人工复核
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

### 9.4 ⚠️ 制度冲突登记（裁决 4b）：REQ-06 / REQ-07 的"临时下载地址"

**冲突事实**：`specs/production-governance-20260802/requirements.md` L143-144（PM 编号 REQ-06 / REQ-07）的条文**以"生成临时下载地址"为触发条件**来描述鉴权与审计要求；而本轮方案明令"不生成公开对象 URL、前端不得直连 COS"。二者**直接冲突**——若严格按字面读，本轮不生成任何临时地址，这两条的触发条件永不成立，鉴权/审计要求形同虚设。

**处置（依团队长裁决）**：
- 本轮实现采用 **API 服务端代理流式下载**：客户端（带 JWT） → `GET /api/.../source-file` → 服务端 `driver.get()` → `StreamableFile`。**不签发任何预签名 URL、不生成任何临时下载地址。**
- REQ-06 / REQ-07 的**实质意图**（下载须鉴权、须审计、须防越权）由 §9.1/§9.2 的代理下载路径**完整承接**，不因触发条件不成立而落空。
- **specs 四件套正文的改写属独立授权任务，本轮不动。**

**状态：待上游裁定条文改写（PENDING）。** 本轮仅登记冲突并说明实质意图的承接方式。

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

### 10.1 门禁落点清单（PM 取证 IMP-01~IMP-14）

PM 用只读 `grep` 取证，在本仓库定位 **14 处**受 CFS/挂载强绑定的真实落点（详见 `evidence/governance/COS-SDK-DIRECT-I1-REQUIREMENTS-ALIGNMENT.md` §1.5）。D 阶段任务必须全部覆盖；下方"覆盖任务"列与本任务文档 §6 一一对应（A 阶段提交 17bf683 时仅列入 D1 一处，本次依裁决补全其余落点）。

| IMP | 文件:行 | 性质 | 覆盖任务 |
|---|---|---|---|
| IMP-01 | `apps/api/src/facts/fact-source-storage.config.ts:3` | 硬编码挂载路径常量 `PRODUCTION_FACT_SOURCE_STORAGE_ROOT` | D1（保留，仅 local 分支） |
| IMP-02 | `apps/api/src/facts/fact-source-storage.config.ts:12-25` | 生产挂载强校验（启动即失败） | D1 |
| IMP-03 | `apps/api/src/facts/fact-source-file-storage.service.ts:1-6,17-46,52-88` | 本地 `node:fs/promises` 内容寻址实现 | B3（逻辑内移为 Local driver）+ D1（`onModuleInit` 仅 local 校验挂载） |
| IMP-04 | `apps/api/src/runtime.config.ts:27-29` | 生产配置硬校验 `FACT_SOURCE_STORAGE_ROOT_INVALID` | D1（本轮回填发现的**第二处**硬校验） |
| IMP-05 | `Dockerfile:42,45,46` / `apps/api/Dockerfile:44,47,48` | 镜像声明挂载依赖 | D2 |
| IMP-06 | `scripts/test/check-fact-storage-gate.mjs:9-18` | 门禁硬断言 `MOUNT_NOT_FOUND` / `fuse.cosfs` | D4（全文改写） |
| IMP-07 | `scripts/test/check-container-runtime.mjs:45` | 容器门禁断言存储根 env | D2/D4（移除挂载断言，改 COS env 存在性） |
| IMP-08 | `scripts/test/check-production-runtime-config.mjs:30`、`run-deployment-preflight.mjs:16,36` | preflight 门禁固定含挂载根 | D4 |
| IMP-09 | `apps/api/.env.example:24` | 配置样例含挂载根 | D6（改写 COS 变量样例） |
| IMP-10 | `apps/api/scf_bootstrap:16` | **仓库唯一 CFS 字样运行时文件** | D6（改写表述，去除 CFS 误导） |
| IMP-11 | `docs/deployment-guide.md:35,40,64` | 部署文档绑定挂载点 | D6 |
| IMP-12 | `docs/v3.1-migration-lineage-runbook.md:65,67,72,84` | 运维手册绑定 CFS/挂载 | D6 |
| IMP-13 | `docs/import-job-file-migration-runbook.md:13,31,36` | 迁移手册 `--storage-root` | D6 |
| IMP-14 | `package.json:24` | `test:storage-gate` 门禁入口 | D4（保留命令名，改写脚本） |

> 注：IMP-15（全仓零 COS SDK / 签名 URL 基线）、IMP-16（`apps/mini-program` 与 `apps/miniapp` 双目录，C-6.5 扫描范围未定义）属治理基线事实，已在 §11 R12 登记、C 阶段门禁扫描从严覆盖两者，不单独列任务。

---

## 11. 风险与待上游拍板事项

| # | 事项 | 说明 | 影响 | 状态 |
|---|---|---|---|---|
| **R1** | **临时凭据 vs 长期凭据（最高优先级）** | 已核验：`tcb secrets` **只有 `get`**，返回的是**当前登录会话的临时凭据（有时效）**，不是长期运行服务的密钥注入设施。长期运行的 CloudRun 服务需要：(a) 长期 SecretId/SecretKey 经环境变量注入；或 (b) STS 临时凭据 + 服务内定时刷新 + `COS_SESSION_TOKEN`。两者实现复杂度差异显著（(b) 需额外的凭据刷新器与过期重试逻辑）。**与 PM 的 Q-06 为同一问题，两人独立指向。**<br>**设计侧已做兼容处理**：driver 内部一律从配置对象读取凭据（含可选 `sessionToken`），**不硬编码任何一种形态**；`COS_SESSION_TOKEN` 已列为可选环境变量（§4.4）。因此两种裁定结果都不需要重构 driver 结构，差异仅在于是否追加"凭据刷新器"组件 | 决定是否需实现凭据刷新器；决定 D 阶段工作量 | **已裁定（Codex PG-20260805-COS-D-CORRECTION）**：采用 **STS 临时凭据刷新**；长期 SecretId/SecretKey **不得作为默认生产方案**。<br>**BLOCKED_STS_ISSUER_UNDEFINED**：真实 STS issuer（endpoint/角色/刷新协议）尚不可确认，不得自行编造；禁止用 fake provider 冒充真实 STS。D1-D6 不因此阻塞，F 阶段保持 BLOCKED |
| **R2** | 无真实凭据 ⇒ F 阶段 BLOCKED | 本机 `COS_SECRET_ID/KEY/BUCKET/REGION/JWT_SECRET` 全部 UNSET（已核验） | A~E 不受阻（Local + 伪 COS 客户端可测）；F 阶段需凭据 | 已知，设计已适配 |
| **R3** | L0 回滚的数据可见性缺口 | 切回 local 后 COS 期新对象在本地盘不存在，下载走 404（元数据不丢） | 需上游确认可接受 | **待确认** |
| **R4** | **并发竞态（合并论述：对象层 TOCTOU + 业务层查重窗口）** | **(a) 对象层**：`deduplicated` 判定存在 TOCTOU，并发同 sha 可能都判 `false`。危害有限——删除幂等（ENOENT 静默）、内容寻址保证最终内容一致。<br>**(b) 业务层（更严重）**：ws6 侧应用层"先查后写"幂等（§5.2b）在极端并发下**会真实产生重复 `import_jobs` 行**，因 009 的 `idx_import_jobs_storage_key` 为**非唯一**索引，数据库层无兜底 | (a) 极端情况下 A 的补偿可能删掉 B 刚提交所引用的对象；(b) C-3.3 在高并发下可能不满足 | **本轮已知残留风险，接受**。<br>缓解 (a)：补偿删除前复查 DB 引用，有则不删（**已写入 §6.3 实现**）<br>缓解 (b)：无本轮内彻底方案；根治需 T-010-MIGRATION 唯一约束（**PENDING，见 §5.3**）。E 阶段的 C-3.3 并发用例若在高并发下偶发失败，应记为已知缺口而非实现缺陷 |
| **R9** | **DDL 边界与 C-1.4 冲突** | 裁决 3 判定本轮零 DDL，`contentType` 不入库；但 PM 验收项 C-1.4 要求 `contentType` **落库** | C-1.4 的 `contentType` 子项本轮无法通过 | **已登记**：该子项降级为"不适用（本轮）"，T-010-MIGRATION 获授权后恢复。见 §5.3 |
| **R10** | **ACL 矩阵缺主体，C-6 无验收落点** | PM 判定 `specs/production-governance-20260802/access-control-matrix.md` 缺少两类主体：**「应用运行时身份」**（API 服务访问 COS 的身份）与**「匿名/终端用户」**。导致 C-6（匿名拒绝）**在权限矩阵中无落点可供验收** —— 即代码可以实现 401/403，但无法对照矩阵证明"符合既定权限设计" | C-6.1 / C-6.3 缺规范依据；治理证据链在 G 阶段会出现断点 | **待上游补充矩阵条目（PENDING）**。本轮代码照常实现 401/403（§9.2），但验收时须标注"矩阵缺主体，仅能证明行为正确、无法证明合规对齐" |
| **R11** | **错误码命名不一致** | PM 验收项 C-5.4 使用 `IMPORT_SOURCE_HASH_MISMATCH`，本设计沿用既有 `SOURCE_FILE_HASH_MISMATCH`（`fact-source-file-storage.service.ts:54` 实际字符串） | 若按 PM 字面实现会引入第二套命名 | **本设计以代码实际字符串为准**（`SOURCE_FILE_*`，§2.3 已锁定前 4 个既有码不得更改）。C-5.4 判定时按 `SOURCE_FILE_HASH_MISMATCH` 断言，须在验收报告中注明该命名映射 |
| **R12** | **前端扫描范围未定义** | 已核验 `apps/` 下**同时存在** `apps/mini-program/` 与 `apps/miniapp/` 两个小程序目录，权威目录未声明（PM 的 Q-11） | C-6.5"前端零 COS 引用"扫描范围不明 | **待上游指明权威目录（PENDING）**。本轮门禁扫描**两者均覆盖**，从严处理 |
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
9. Local driver 始终可用（无凭据可跑全部单测）
10. 根 Dockerfile 与 `apps/api/Dockerfile` 保持一致
</content>
