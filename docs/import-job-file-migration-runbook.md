# 旧 Base64 文件迁移 Runbook（D-06）

**适用**：biz-reporting-system 治理批次 PG-20260802 D-06
**工具**：`scripts/oneoff/migrate-import-job-files.mjs`
**目标**：将 `import_jobs.source_file_base64` 存量数据迁移到内容寻址持久存储（`<storage_root>/<sha256 前两位>/<sha256>`），回填 `source_file_storage_key / source_file_sha256 / source_file_size / source_file_stored_at`。

---

## 1. 前置条件

- 已执行 009 迁移（`import_jobs` 含 D-01 七字段）。
- 数据库可连接（sqlite 路径 或 MySQL 连接参数）。
- 存储可写：目标为**私有 COS 对象存储 + 后端 COS SDK 直连**（`FACT_SOURCE_STORAGE_DRIVER=cos`，经 `FactSourceFileStorageService` 写入逻辑键 `xx/<sha256>`）；`local` 驱动（`FACT_SOURCE_STORAGE_ROOT`）仅为本地开发/回滚路径（历史 CFS 方案，**非当前方案**）。
- **本工具不实现清空 Base64**：迁移后历史 Base64 保留，回退安全。

## 2. 安全模型

| 场景 | 行为 |
|------|------|
| 默认（无 `--apply`） | **dry-run**：只报告将迁移的 job 数/ID/hash 前缀，零写入 |
| `--apply` 缺 `--env-id` | **exit 2 硬失败**，拒绝任何写入 |
| `--apply --env-id` 与 DB 标识不匹配 | **exit 2 拒绝写入**（防误连生产） |
| 迁移失败（hash 不一致 / 解码失败 / 存储失败） | 保留 Base64 不动，输出脱敏 job ID + 错误码，exit 1 |

## 3. 用法

```bash
# 1) dry-run 评估（推荐先跑）
node scripts/oneoff/migrate-import-job-files.mjs \
  --db /path/to/biz.sqlite \
  --storage-root /mnt/fact-source-files

# 2) apply（隔离/生产，需 --env-id 与 DB 标识匹配）
node scripts/oneoff/migrate-import-job-files.mjs \
  --db /path/to/biz.sqlite \
  --storage-root /mnt/fact-source-files \
  --apply --env-id <数据库标识片段>
```

> 也可用环境变量：`MIGRATION_TEST_DB_DATABASE` / `FACT_SOURCE_STORAGE_ROOT`。
> 生产 MySQL 场景：请使用隔离客户端经 SSH 隧道/跳板连接，`--db` 指向导出后的 sqlite 副本执行迁移后回写，或按生产变更流程（G-02/G-06）在窗口内执行。

## 4. 执行流程

1. **校验**：表结构含 D-01 字段，否则 exit 2。
2. **游标扫描**：`id > cursor ORDER BY id LIMIT 20`（禁止 OFFSET 全表扫描）。
3. **逐 job**：
   - `source_file_storage_key` 非空 → 跳过（已迁移，幂等）。
   - 无 `source_file_base64` → 跳过。
   - base64 解码失败 / 空内容 → failed（`BASE64_DECODE` / `EMPTY_BASE64`）。
   - `source_file_sha256` 已存在且与内容 hash 不一致 → failed（`HASH_MISMATCH`，**不迁移**，保留原数据待人工复核）。
   - dry-run：记录将迁移项，不写盘不更新 DB。
   - apply：`mkdir -p` → `writeFileSync(flag='wx')`（EEXIST 视为已迁移幂等）→ `UPDATE import_jobs SET storage_key/sha256/size/stored_at`。
4. **汇总输出**：`mode / env_id / scanned / migrated / skipped / failed` + 明细（脱敏：ID + 错误码/hash 前缀）。

## 5. 退出码

| 码 | 含义 |
|----|------|
| 0 | 完成（failed=0；dry-run 正常报告） |
| 1 | 存在失败项（hash 不一致等），保留 Base64，需人工复核 |
| 2 | 参数/连接/结构错误（含缺 `--env-id`、env-id 不匹配） |

## 6. 故障注入与验收

测试覆盖（`scripts/test/migrate-import-job-files.test.mjs`，6/6 pass）：
- dry-run 零写入（存储目录不创建、DB metadata 不变）
- apply 缺 `--env-id` → exit 2
- apply `--env-id` 不匹配 → exit 2
- apply 写存储 + metadata；**re-run 幂等**（skipped，不重复写）
- hash 不一致 → failed `HASH_MISMATCH` 且保留 Base64
- 已迁移任务跳过

## 7. 回滚

- 迁移为**前向扩展**（只新增 storage metadata，不清 Base64）——如需回退，删除新写入的存储文件并清空 `source_file_storage_key` 等字段即可恢复原状。
- 不提供自动回滚脚本；按需手工处理（数量少时）。

## 8. 授权提示

- dry-run：L1（只读）。
- 隔离库 apply：**I1**（需隔离环境授权）。
- 生产 apply：**P1**（需生产变更授权，建议并入 G-02/G-06 窗口，先备份 import_jobs 表）。
