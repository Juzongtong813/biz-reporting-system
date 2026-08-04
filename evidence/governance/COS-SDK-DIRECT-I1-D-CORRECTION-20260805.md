# COS SDK 直连存储改造 I1 — A-D 验收退回纠偏（PG-20260805-COS-D-CORRECTION）

- 日期：2026-08-05
- 执行：主理人 齐活林（Qi）（团队 worker 反复失效，按 Codex 令第 7 条直接接管执行）
- 上游裁定：Codex PG-20260805-COS-D-CORRECTION

## 裁定摘要

- A：REVIEW_COMPLETE，需修正 R1 决策记录 ✅（本次已修正）
- B：REVIEW_COMPLETE_WITH_FINDINGS（本次未再改动 B 产出；findings 见下）
- C：REVIEW_COMPLETE（本地补偿测试通过，未再改动）
- D：REJECTED_INCOMPLETE → 本次执行 D1-D6 纠偏
- F：继续 BLOCKED，严禁部署

## B 阶段 findings（登记）

- B7 文字"同时提供 COS_CLIENT"与设计 v2 §2.4 硬约束冲突，实现遵循设计 v2（不注册 COS_CLIENT token），已在 `cos-client.interface.ts` 头注释登记。
- B8 `@nestjs/testing` 未安装，模块装配验证用工厂直调方式（既有模式）。

## D1-D6 执行记录（逐项）

| 项 | 内容 | 文件 |
|---|---|---|
| D1 | 解除生产 COS driver 的 CFS 强校验：`assertProductionFactSourceStorage` 增加 driver 语义（cos 不读 mountinfo、不要求 ROOT）；`runtime.config.ts` 仅 local 校验挂载根 | `apps/api/src/facts/fact-source-storage.config.ts`、`apps/api/src/facts/fact-source-file-storage.service.ts`、`apps/api/src/runtime.config.ts` |
| D2 | 双 Dockerfile 同步：删 `/mnt/fact-source-files` 创建/chown、删 `FACT_SOURCE_STORAGE_ROOT` 默认、删 `required-persistent-mount` label、加 `FACT_SOURCE_STORAGE_DRIVER=cos`；保留非 root/健康检查/PORT/双文件一致；零 COS 密钥 | `Dockerfile`、`apps/api/Dockerfile` |
| D3 | 架构门禁补强：AR-R7-a 业务层禁 COS SDK；AR-R7-b SDK 仅 cos-client.factory；AR-R7-c 禁公开/预签名 URL 与 ACL=public；AR-R7-d 禁恢复 FACT_SOURCE_STORAGE Symbol；AR-R7-e 禁 CFS cosfs 恢复 | `scripts/architecture/check-dependencies.mjs` |
| D4 | storage gate 双分支（local 回滚 + cos 无挂载根）；container gate 无挂载声明/无密钥/driver=cos；preflight 不再要求 ROOT（cos 分支断言）；I1 manifest 改 COS 变量 + BLOCKED_STS_ISSUER_UNDEFINED | `scripts/test/check-fact-storage-gate.mjs`、`check-container-runtime.mjs`、`check-production-runtime-config.mjs`、`run-deployment-preflight.mjs`、`i1-manifest.json` |
| D5 | 孤儿盘点脚本改名 `list-orphan-operation-log.mjs`，明确定位为 operation-log 离线盘点（未核对真实 COS），不加删除开关 | `scripts/oneoff/list-orphan-operation-log.mjs`（git mv） |
| D6 | `.env.example`/`scf_bootstrap`/deployment-guide/import runbook 统一为私有 COS 方案；历史 CFS 标注非当前方案 | `apps/api/.env.example`、`apps/api/scf_bootstrap`、`docs/deployment-guide.md`、`docs/import-job-file-migration-runbook.md` |

## STS 边界（令四）

- `EnvCredentialProvider`：production 下无 STS 形态（sessionToken + expiresAt）→ 抛 `BLOCKED_STS_ISSUER_UNDEFINED`，**禁止静默退回永久环境变量密钥**；非 production 长期密钥仍可用（仅本地联调）
- `RefreshingCredentialProvider` 保持抽象；`FakeCredentialProvider` 仅测试
- 未编造 STS endpoint/角色/刷新协议；真实 issuer 待 F 阶段确认

## 测试矩阵（全部本地门禁通过；Docker 镜像构建 PENDING_DOCKER）

| 门禁 | 命令 | 退出码 |
|---|---|---|
| API v3 typecheck | `tsc --noEmit -p tsconfig.json` | 0 ✅ |
| API build | `pnpm --filter @biz-reporting/api build` | 0 ✅ |
| test:unit | `pnpm test:unit` | 0（25 文件，D 阶段 20 用例含 D-8a/b/c STS 边界）✅ |
| test:storage-gate | `pnpm test:storage-gate` | 0（driver=cos\|local 双分支）✅ |
| test:deployment-preflight | `pnpm test:deployment-preflight` | 0（含 cos 无 ROOT 断言）✅ |
| test:architecture | `pnpm test:architecture` | 0（AR-R7-a~e）✅ |
| check-container-runtime | `node scripts/test/check-container-runtime.mjs` | 0（PENDING_DOCKER：本机无 docker，不伪造镜像构建 PASS）✅ |
| migration checksum/ledger | `migrate.mjs check-files` + `up` + `status`（sqlite） | 0（11 迁移，零新增 DDL）✅ |
| git diff --check | `git diff --check` | 0 ✅ |

## 额外断言（令五）

- production + driver=cos 无挂载根 → 通过 ✅
- production + driver=local 无挂载 → 失败（FACT_SOURCE_STORAGE_ROOT_REQUIRED_IN_PRODUCTION）✅
- 双 Dockerfile 规范化一致 ✅
- 活跃运行文件（.env.example/scf_bootstrap/Dockerfile×2）无 CFS/`/mnt/fact-source-files` 字面量 ✅
- Dockerfile 无 COS_SECRET/SESSION_TOKEN/凭据值 ✅
- fake COS 测试无网络请求（无 http/fetch/net/dgram/axios）✅

## 提交

- `docs: record STS credential decision and D correction scope`（规格修正）
- `fix(api): complete COS runtime and container migration`（D1-D6）
- `test: align gates with COS SDK direct runtime`（测试/证据纠偏）

## 最终状态标记

- **D_CORRECTION_REVIEW_COMPLETE**
- **F_BLOCKED**（BLOCK_STS_ISSUER_UNDEFINED + BLOCK-F-01/02/03 + PENDING_DOCKER）
