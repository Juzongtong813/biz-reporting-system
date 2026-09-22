# 分支证据：feature/analysis-year-month-contract-admin-crud

日期：2026-08-21　分支：`feature/analysis-year-month-contract-admin-crud`

## 一、本次完成内容

### 1. 经营分析：年度 + 月份双筛选（前端 + 后端）
- 后端新增 `GET /biz/analysis/years`（`biz-aggregate.controller.ts` / `biz-aggregate.service.ts.availableYears`）：从 `biz_monthly_aggregates` 动态生成可用年度（`SUBSTR(business_month,1,4)`，SQLite/MySQL 均 1 起始，已验证），并始终包含当前年度；前端不写死年度列表。
- 前端 `BizAnalysis.tsx`：新增年度筛选（默认当前年度+全年）、月份筛选（选年度查全年、年度+月份查指定年月、清空=累计）；年份切换自动清空月份；年度/月份透传 overview/trend/by-city/overrun-list；导出文件名含年度月份；提示文案更新。
- 后端 overview/trend/by-city/overrun-list 已支持 year/month 参数（此前分支已改），本次补前端联动。

### 2. 合同管理：单行 + 批量操作（前端）
`BizContracts.tsx` 新增：
- 单行操作：编辑（未锁定合同额可改金额）、删除（软删除）、恢复（已删除行显示"已删除"标签+恢复按钮）。
- 批量操作：批量编辑、批量删除、批量恢复、导出选中（CSV，含 BOM；开启"显示已删除"后导出包含已删除行）。
- 权限门控：`operation.contract.delete / batch_create / batch_update / batch_delete / restore / export`（新 6 码，021 迁移授予 admin/contract_manager）。
- 批量按钮在未选中时置灰；跨分页全选（`preserveSelectedRowKeys` + `SELECT_ALL/INVERT/NONE`，antd 5.29.3 已验证 API 存在）；批量结果弹窗逐条返回失败原因。
- 列表支持"显示已删除"开关（`includeDeleted=true` 透传后端）。

### 3. 后端缺陷修复（本次测试发现）
- `exportCsv`：当传入 `ids` 时原先忽略 `includeDeleted`（列表默认排除已删除），导致"导出选中+已删除"丢行。已修复：ids 模式同样透传 `includeDeleted`。

### 4. 意外改动回退
- 工作区残留将 contract_manager 数据范围从 `contract` 改为 `province` 的未提交改动，违反 M2 合约（"contract_manager 无业务明细范围"）。已回退为 `contract`，并加注释说明（`rbac.service.ts`）。

### 5. 迁移账本契约更新
- `run-migration-ledger-contract.mjs`：20 → 22（补齐 020/021 断言与日志）；019/020/021 三个迁移文件已由迁移账本校验通过（checksums 22 项一致，幂等重跑验证通过）。

### 6. 测试增强（自验证）
- `run-m6-aggregates.mjs` 新增 **AGG-009**：/analysis/years 返回年度集合（含 2026 与当前年度）、year=2026 过滤、year=2025 空数据、year+month 组合。
- `run-m3-contracts.mjs` 新增 **CON-011**：单条删除（city_user 403 / admin 200）、includeDeleted 列表、单条恢复、批量删除（含重复删除跳过原因）、批量恢复、批量修改、导出选中含已删除行、city_user 导出数据范围过滤；**CON-008** 更新为 019 授权后 admin 可取消分配（city_user 403 / admin 200 / super 200）。

## 二、验证证据（命令 + 退出码）

| 检查 | 命令 | 结果 |
|---|---|---|
| shared-types 构建 | `pnpm --filter @biz-reporting/shared-types build` | ✅ |
| 全仓 typecheck | `pnpm --filter @biz-reporting/admin-web typecheck` / `... api typecheck` | ✅（0 错误） |
| admin-web 生产构建 | `pnpm --filter @biz-reporting/admin-web build` | ✅ built in ~22s |
| api 生产构建 | `pnpm --filter @biz-reporting/api build` | ✅ |
| 迁移账本契约 | `pnpm test:migrations:ledger` | ✅ `MIGRATION_LEDGER_CONTRACT_OK migrations=22 ... idempotent=true` |
| RBAC/Auth（M2） | `pnpm test:m2-rbac-auth` | ✅ exit=0 `M2_RBAC_AUTH_OK ...` |
| 合同域（M3） | `pnpm test:m3-contracts` | ✅ exit=0 `M3_CONTRACTS_OK CON-001..011 ...` |
| 汇总分析（M6） | `pnpm test:m6-aggregates` | ✅ exit=0 `M6_AGG_OK AGG-001..009 ...` |
| 年度 SQL 方言烟测 | better-sqlite3 `SUBSTR` 验证 | ✅ `availableYears => ["2024","2025","2026"]` |
| antd API | `Table.SELECTION_ALL/INVERT/NONE`、`preserveSelectedRowKeys` | ✅ antd 5.29.3 |

### 测试中修复的回归
1. `exportCsv` ids 模式忽略 includeDeleted（后端修复，见上）。
2. `M2` 因 contract_manager scope 误改而失败 → 回退并注释（见上）。
3. `M2` 清理阶段 Windows 文件锁 EPERM 掩盖原始断言 → finally 改为 best-effort 清理，不掩盖原始错误（脚本健壮性）。

## 三、遗留项（未完成，需用户确认后继续）

1. **#10 浏览器验证与 CloudBase 部署**：需要用户确认环境（本地 API+DB 启动方式 / CloudBase 部署授权）。本分支未做真实浏览器端渲染验证与云端部署。
2. **#11 文档更新与 Git 提交**：变更尚未 commit（工作区含多处此前分支改动）；待用户确认后提交，产出交付报告。
3. 真实 MySQL 隔离 gate（127.0.0.1:34001）验证：本机未启动，M2/M3/M6 均在 SQLite 模式验证（符合分支历史 BLK-1 约束）。

## 四、涉及文件清单

后端：`biz-aggregate.service.ts`（availableYears）、`biz-aggregate.controller.ts`（GET analysis/years）、`biz-contracts.service.ts`（exportCsv includeDeleted 修复）、`rbac.service.ts`（scope 回退注释）。
迁移：`019/020/021_*.sql`（此前分支产出，本轮账本校验）。
前端：`biz.api.ts`（includeDeleted/restore/years）、`BizAnalysis.tsx`（双筛选）、`BizContracts.tsx`（单行+批量操作）。
测试：`run-migration-ledger-contract.mjs`、`run-m3-contracts.mjs`（CON-011 + CON-008）、`run-m6-aggregates.mjs`（AGG-009）、`run-m2-rbac-auth.mjs`（清理健壮性）。

---

# 补充：权限缓存跨账号污染修复（人工验证发现，2026-08-21）

## 一、问题现象（用户人工验证反馈）

> super 账号在权限管理把地市账号（demo_city）合同详情权限从"读写"改为"只读"保存后，
> super 自己的合同管理页"删除"按钮消失。

## 二、根因（代码实证）

**前端 `apps/admin-web/src/utils/biz-permission.ts` 的模块级权限缓存不绑定用户会话：**

- `cachedPermissions` 是模块级变量，仅按 60s TTL 失效，**不校验当前登录用户/token**；
- 登录成功（BizLogin）与登出（BizPortal/BizLayout/BizMaintenancePortal）都只读写 token，**不清权限缓存**；
- 复现链：demo_city 登录 → 进合同管理（缓存 city 权限：`isSuper=false` 且无 `operation.contract.delete`）→ 退出 → 60s 内 super 登录 → 进合同管理 → `loadBizPermissions()` 命中旧缓存 → `canDeleteContract=false` → **删除按钮消失**。

**后端排除（curl 实证）：**

| 检查 | 结果 |
|---|---|
| super me | `roleCode=super_admin`，`permissions=["*"]`（通配）→ isSuper 判断成立 |
| demo_city me | `operation.contract.delete` 不在（override deny 生效）、`operation.contract.read` 在 |
| override 维度 | `biz_user_permission_overrides` 按 userId 存储，46 条全部指向 demo_city，不影响 super |

## 三、修复（4 文件）

1. **`biz-permission.ts`**：缓存结构增加 `tokenFingerprint`（token 尾 16 位）；`loadBizPermissions` 每次校验指纹，登出/切换账号 → token 变化 → 缓存立即失效；新增导出 `clearBizPermissionCache()`（登录成功/登出显式调用，双保险）。
2. **`BizLogin.tsx`**：登录成功 `setBizToken` 后调用 `clearBizPermissionCache()`。
3. **`BizPortal.tsx`**：401 失效 / 403 返回登录 / 退出按钮 3 处登出补清缓存（原 2 处 + 新增）。
4. **`BizLayout.tsx`**：me 失败跳登录 / 改密后重新登录 / 退出菜单 3 处补清缓存。
5. **`BizMaintenancePortal.tsx`**：401 失效 / 返回登录 2 处补清缓存。

全局排查确认：admin-web 内模块级缓存仅此一处（`grep "let cached"`），无其他跨账号共享缓存。

## 四、验证

- ✅ `pnpm --filter @biz-reporting/admin-web typecheck` 0 错误
- ✅ `pnpm --filter @biz-reporting/admin-web build` 构建通过
- ✅ 后端 override 流程 curl 实证（super 通配不受影响；city deny 生效）
- ⏳ 浏览器人工复现：demo_city 登录→合同页→退出→super 登录→合同页，删除按钮应恢复显示
