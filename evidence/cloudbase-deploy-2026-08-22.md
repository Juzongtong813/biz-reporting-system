# CloudBase 生产部署证据报告

- **部署时间**：2026-08-22 11:47 – 12:12（GMT+8）
- **环境 envId**：`zy-data-d2g9g1ghr47ac6254`
- **仓库根**：`E:\code2\biz-reporting-system-authoritative`
- **分支**：`feature/analysis-year-month-contract-admin-crud`
- **部署内容**：经营分析年月双筛选 + 合同管理 CRUD/批量操作 + 前端权限缓存跨账号污染修复

---

## 一、访问入口（重要）

**请使用下列域名访问系统**（CORS 白名单内，已实测放行）：

| 用途 | URL | 状态 |
|---|---|---|
| **推荐入口** | https://zy-data-d2g9g1ghr47ac6254-1362656322.ap-shanghai.app.tcloudbase.com | ✅ 200 / CORS 放行 |
| 备用入口 1 | https://biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com | ✅ 200 / CORS 放行 |
| 备用入口 2 | https://zy-data-d2g9g1ghr47ac6254.service.tcloudbase.com | ✅ 200 / CORS 放行 |
| ⚠️ 不要使用 | https://zy-data-d2g9g1ghr47ac6254-1362656322.tcloudbaseapp.com | 页面能打开，但 **API 跨域被拦截** |

后端 API：`https://biz-reporting-api-prod-265611-4-1362656322.sh.run.tcloudbase.com`

> 三个推荐域名指向**同一份**静态托管产物（实测均返回 `index-TXW18w-4.js`），内容完全一致，任选其一即可。

---

## 二、Phase 0 — 本地构建校验与回滚点

| 检查项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 退出码 0（shared-types / shared-constants / api / admin-web 全 Done） |
| 后端构建 | `pnpm --filter @biz-reporting/api build` | 退出码 0（nest build） |
| 前端构建 | `pnpm --filter @biz-reporting/admin-web build` | 退出码 0（built in 8.70s） |
| 空白错误 | `git diff --check` | 零输出 |
| 产物 API 地址 | `grep` dist/assets | `biz-reporting-api-prod-...sh.run.tcloudbase.com`，`localhost` 残留计数 = 0 |

**回滚点**

- 上线版本 commit：`67ce9d5b56c55652fff8bc643fd629235f93d87b`（33 文件，+1342 / -121）
- 回滚目标 commit：`d32ff7c7ed430ff5193c69814dbd31a8b4b96ee5`
- 回滚方式：`git reset --hard d32ff7c7` + 重新部署 CloudRun（迁移为幂等加列，无需回退）
- 未跟踪保留（未混入提交）：`deploy/`、`docs/nas-deployment.md`、`evidence/`、`test-results/`

---

## 三、Phase 2 — 后端 CloudRun 部署

| 项 | 值 |
|---|---|
| 服务名 | `biz-reporting-api-prod` |
| 上线版本 | `biz-reporting-api-prod-015`（前版 014） |
| 镜像 | `ccr.ccs.tencentyun.com/tcb-100042718991-bfdg/ca-ssxlthbm_biz-reporting-api-prod:biz-reporting-api-prod-015-20260822115422` |
| BuildId | `2601887855` |
| RunId | `multi_tenant_1wxcoE8UxSRTQP` |
| 构建方式 | 源码构建，`Dockerfile=Dockerfile`（仓库根），`BuildDir=.` |
| 部署完成 | 2026-08-22 11:54:18 |
| 状态 | `Status=normal`、`FlowRatio=100`、`HasTraffic=true` |
| 配置保留 | `mergedFromRemote: ["EnvParams","OpenAccessTypes"]` — 27 个生产变量（DB_*/JWT_*/CORS_ORIGINS 等）原样保留，`verifiedAfterDeploy` 复核一致 |

**部署前后对比（证明新代码生效）**

| 接口 | 部署前 | 部署后 |
|---|---|---|
| `/api/biz/analysis/years` | **404**（路由不存在） | **401**（路由存在，需鉴权） |

**良性告警**：`MISSING_VPC_FOR_DB_ENV` — 生产 `DB_HOST` 为公网 CynosDB 域名（`sh-cynosdbmysql-grp-p18a65zm.sql.tencentcdb.com:24840`），本就无需 VpcConf，旧版 014 亦如此，可忽略。

---

## 四、Phase 2b — 生产 MySQL 迁移 019/020/021

**执行通道**：CloudBase MySQL MCP（`runStatement` / `runQuery`）。生产库与 MCP 默认库同实例但不同 schema，**所有语句均显式加 `biz_reporting_prod.` 前缀**。

**执行前状态核查**

| 核查项 | 结果 |
|---|---|
| 账本已应用 | 001–018（19 条记录），019/020/021 均无记录 |
| 019 依赖的 8 个权限码 | 全部已存在于 `biz_permissions` |
| 020 的 7 个目标列 | **全部缺失**（查询返回 0 行） |
| 021 的 6 个新权限码 | 全部不存在 |
| 角色 UUID 校验 | `admin=...0002`、`contract_manager=...0003`，与 021 硬编码完全一致 |
| module_id 校验 | `...0020 = operation`，匹配 |

**执行结果**

| 迁移 | 语句 | rowsAffected |
|---|---|---|
| 019-a | admin 角色 8 权限授权 | 0（已存在，幂等 no-op） |
| 019-b | contract_manager 12 权限授权 | 0（已存在，幂等 no-op） |
| 020-a | `biz_contracts` ADD `deleted_at`/`deleted_by`/`deleted_batch_id` | ALTER 成功 |
| 020-b | `CREATE INDEX idx_biz_contracts_deleted` | 成功 |
| 020-c | `biz_operation_logs` ADD `summary_before`/`summary_after`/`batch_id`/`error_message` | ALTER 成功 |
| 020-d | `CREATE INDEX idx_biz_op_log_batch` | 成功 |
| 021-a | 6 个合同权限码 | **6** |
| 021-b | admin + contract_manager 各 6 条授权 | **12** |
| 账本 | `schema_migrations` 写入 3 条（完整 sha256） | **3** |

**执行后验证**

| 指标 | 期望 | 实测 |
|---|---|---|
| 新增列数 | 7 | **7** ✅ |
| 新增索引数 | 2 | **2** ✅ |
| `biz_permissions` 总数 | 39 + 6 = 45 | **45** ✅ |
| `biz_role_permissions` 总数 | 68 + 12 = 80 | **80** ✅ |
| `schema_migrations` 总数 | 19 + 3 = 22 | **22** ✅ |

写入账本的 checksum（与 `scripts/db/migration-checksums.json` 一致）：

```
019_biz_admin_crud_permissions      05b95964238b3b77fa6c0f738a0d9a06b259542b10421fd2ba1dbca435ab0de3
020_biz_contract_soft_delete_op_log 0b838c8bc4ac7ab1ec1f295e85c4cdd03ffb2fd9c9c47f348a434ad1f098105b
021_biz_contract_permissions        413f693bbd062b9f30339faaa92de58fbab0ca6edf116a1b878c0c71e24a18e1
```

---

## 五、Phase 3 — 前端静态托管部署

| 项 | 值 |
|---|---|
| 本地产物 | `apps/admin-web/dist`（2.4 MB，51 个 assets，index.html 构建于 11:47） |
| 上传结果 | `successCount=55 / totalFiles=55`，`failedFiles=[]` |
| 忽略规则 | `**/*.map`、`**/.DS_Store`（实测 dist 内 `.map` 计数 = 0） |
| Bucket | `1f50-static-zy-data-d2g9g1ghr47ac6254-1362656322` |
| SPA 路由 | 既有配置已正确：`IndexDocument=index.html`、`ErrorDocument=index.html`、`404 → index.html`（**未改动**） |

**产物指纹一致性**（证明线上即本次构建）

| 位置 | JS | CSS |
|---|---|---|
| 本地 dist | `assets/index-TXW18w-4.js` | `assets/index-CxkVi6rr.css` |
| 线上 | `assets/index-TXW18w-4.js` | `assets/index-CxkVi6rr.css` |

---

## 六、Phase 4 — 全链路验证

**前端（推荐域名）**

| 路径 | HTTP | `id="root"` |
|---|---|---|
| `/` | 200 | 1 |
| `/biz/login` | 200 | 1 |
| `/biz/portal` | 200 | 1 |
| `/biz/contracts` | 200 | 1 |

**静态资源**

| 资源 | HTTP | 大小 |
|---|---|---|
| `assets/index-TXW18w-4.js` | 200 | 1,089,176 B |
| `assets/index-CxkVi6rr.css` | 200 | 12,921 B |
| JS 内烧入 API 域名 | `biz-reporting-api-prod-...sh.run.tcloudbase.com` | `localhost:3000` 计数 = 0 |

**API 路由存在性**（401 = 路由存在且鉴权生效，非 404 缺失）

| 接口 | HTTP |
|---|---|
| `/api/health/live` | 200（time=1.32s） |
| `/api/biz/analysis/years` | 401 |
| `/api/biz/contracts` | 401 |
| `/api/biz/auth/me` | 401 |
| `/api/cities` | 401 |

**CORS 验证**（关键，静态托管与 API 不同源）

| Origin | 预检 | `access-control-allow-origin` |
|---|---|---|
| `...-1362656322.ap-shanghai.app.tcloudbase.com` | 204 | ✅ 正确回显 |
| `biz-reporting-prod-...webapps.tcloudbase.com` | 204 | ✅ 正确回显 |
| `...service.tcloudbase.com` | 204 | ✅ 正确回显 |
| `...-1362656322.tcloudbaseapp.com` | 204 | ❌ **无该头**（被拦截） |
| `evil.example.com`（对照） | 204 | ❌ 无该头（符合预期） |

`access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE` — 含 `DELETE`，合同删除功能所需方法已放行。
`access-control-allow-credentials: true` — 携带 token 的请求可用。

---

## 七、遗留风险与后续事项

1. **`schema_migrations` checksum 格式不一致（既存问题，非本次引入）**
   生产库 001–018 的 checksum 存的是 **12 位截断值**（如 `a3ea807ce8f4`），而当前 `scripts/db/migrate.mjs` 写入并校验的是**完整 64 位 sha256**。
   影响：若未来直接对生产库运行 `migrate.mjs`，会在 001 处触发 `BLOCK checksum_drift` 而中断。
   本次写入的 019/020/021 已按当前代码口径存完整 64 位，自身无 drift。
   建议：后续单独做一次账本口径统一（需独立授权，本次未擅自修改）。

2. **CORS 白名单未包含 `tcloudbaseapp.com` 共享域名**
   本次通过"改用白名单内域名访问"规避，**未修改任何生产配置**。
   若后续希望以 `...-1362656322.tcloudbaseapp.com` 作为正式入口，需将其加入 CloudRun 的 `CORS_ORIGINS` 并重新下发配置（需授权）。

3. **业务功能需登录后人工确认**
   本次验证覆盖到"路由存在 + 鉴权生效 + DB 结构就位 + CORS 放行"。以下需你登录后确认：
   - 经营分析页年度/月份/地市三级筛选取数正确
   - 合同管理单行删除/恢复、批量操作可用
   - super_admin 修改地市账号权限后，自身删除按钮不再消失（本次核心修复）

4. **`mockServiceWorker.js` 随产物上传**
   该文件为 MSW mock worker，仅在被显式注册时生效，生产构建未启用；与既有线上状态一致，本次未做改动。

---

## 八、回滚预案

| 场景 | 操作 |
|---|---|
| 后端需回滚 | CloudRun 控制台将流量切回版本 `014`（镜像仍在），或 `git reset --hard d32ff7c7` 后重新部署 |
| 前端需回滚 | 用回滚 commit 重新 `build` 并 `upload`（静态托管为覆盖式） |
| 数据库 | 019/021 为幂等 INSERT，020 为加列 + 加索引，**均不破坏既有数据**，无需回滚；若必须回退，需单独授权执行 DROP COLUMN |

---

**部署人**：Frontend Developer Agent
**结论**：后端 015 + 前端 55 文件 + 迁移 019/020/021 全部上线成功，全链路技术验证通过。业务功能待登录确认。
