# 维护管理经营数据中台 — 部署与运行手册（M7）

> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 版本：M7（迁移至 014 / 15 个迁移）
> 日期：2026-08-15

---

> M8 修订（2026-08-16）：正式 MySQL gate 已通过，当前迁移为 001-015 共 16 条；BLK-1 已解除，BLK-2 已按退役隔离处置，BLK-3 仍为范围外登记。文档中的旧阻塞状态仅保留为 M7 历史快照。

## 1. 系统结构

| 组件 | 技术栈 | 说明 |
|---|---|---|
| apps/api | NestJS 10 + TypeORM + MySQL 8 | 单体后端（含全部 biz_ 模块） |
| apps/admin-web | Vite 5 + React 18 + AntD 5 | 新基线前端（/#/biz/ 默认入口） |
| packages/shared-* | TypeScript | 共享类型与常量 |
| 数据库 | MySQL 8（生产）/ SQLite（开发与测试） | 迁移式管理，禁用 synchronize |

## 2. 环境变量

### 2.1 数据库（DB_TYPE / DB_DATABASE）
| 变量 | 说明 | 示例 |
|---|---|---|
| `DB_TYPE` | `sqlite` / `mysql` | `mysql` |
| `DB_DATABASE` | SQLite 绝对路径 或 MySQL 库名 | `./data/prod.sqlite` 或 `biz_reporting` |
| `DB_HOST` / `DB_PORT` | MySQL 主机/端口 | `127.0.0.1` / `3306` |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL 账号 | `biz` / `***` |
| `DB_SYNC` | 必须 `false`（生产强制校验） | `false` |

### 2.2 认证安全
| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（生产必须高强度随机） |
| `JWT_ISSUER` / `JWT_AUDIENCE` | 签发者/受众（默认 biz-reporting-api / biz-reporting-clients） |
| `JWT_EXPIRES_IN` | 令牌有效期（默认 8h） |
| `AUTH_SECURITY_HMAC_KEY` | 登录限流桶/审计哈希密钥 |
| `BIZ_SUPER_ADMIN_USERNAME` / `BIZ_SUPER_ADMIN_PASSWORD` | 初始化 super_admin（仅一次性使用） |

### 2.3 其他
| 变量 | 说明 |
|---|---|
| `PORT` | API 端口（默认 3000） |
| `FACT_SOURCE_STORAGE_ROOT` | 订单临时文件存储根（任务结束自动删除） |
| `NODE_ENV` | `production` 时强制 `DB_SYNC=false` |

## 3. 数据库初始化与迁移

```bash
# 1. 建库（MySQL）
CREATE DATABASE biz_reporting CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 2. 执行迁移（001-015，16 条账本记录，幂等可重跑）
# sqlite（开发）：
DB_TYPE=sqlite DB_DATABASE=./data/prod.sqlite node scripts/db/migrate.mjs up
# mysql（生产）：
DB_TYPE=mysql DB_DATABASE=biz_reporting DB_HOST=... DB_USERNAME=... DB_PASSWORD=... node scripts/db/migrate.mjs up

# 3. 初始化 super_admin（密码经环境变量注入，禁止默认密码/命令行参数）
BIZ_SUPER_ADMIN_USERNAME=admin BIZ_SUPER_ADMIN_PASSWORD='<强密码>' node scripts/auth/biz-init-super-admin.mjs
# 就绪检查：
BIZ_SUPER_ADMIN_USERNAME=admin node scripts/auth/biz-init-super-admin.mjs --check   # ready=1

# 4. 创建省级/地市账号（登录后经 系统管理→权限管理 创建）
```

迁移规则：新迁移只追加（016 起），不改旧文件/checksum；当前 001-015 共 16 条（002 含双文件）。`scripts/db/migration-checksums.json` 记录 sha256，`pnpm migration-files:check` 校验。

## 4. 构建与部署

### 4.1 构建
```bash
# M8 current migration baseline: apply 001-015 (16 ledger entries, including both 002 files); rerun is idempotent. New migrations append from 016 onward.

pnpm install
pnpm --filter @biz-reporting/shared-types build
pnpm --filter @biz-reporting/api build       # apps/api/dist
pnpm --filter @biz-reporting/admin-web build # apps/admin-web/dist（Vite base 为相对路径 './'）
```

### 4.2 部署形态（三选一）
- **A. 同源部署（推荐）**：Nginx 将 `/` 指向前端 dist，`/api` 反代到后端；前端 `.env.production` 的 `VITE_API_BASE_URL=/api`，构建后无需改动。
- **B. 独立域名**：前端与 API 分域名；构建时 `VITE_API_BASE_URL=https://api.example.com/api`。
- **C. 子路径部署**：改 `vite.config.ts` 的 `base` 为 `/subpath/` 并重新构建；API 反代保持 `/api`。

### 4.3 后端启动
```bash
NODE_ENV=production DB_TYPE=mysql ... node apps/api/dist/main.js   # 或 PM2/systemd
```

### 4.4 前端访问
- 默认入口：`/#/biz/login`（根路径自动重定向）
- 旧版界面（已废弃，仅回退）：`/#/login`（页面顶部有废弃提示）

## 5. 账号与权限

| 角色 | 说明 | 菜单 |
|---|---|---|
| super_admin | 全部权限（通配），初始账号经 env 注入 | 全部 |
| admin | 省级运营：合同/订单/完工/成本填报与审核（成本审核需授权） | 经营管理（含分析） |
| contract_manager | 合同维护 | 合同（只读+维护） |
| city_user | 地市：本地市合同/完工/成本填报 | 本地市数据 |

- 成本审核授权：`系统管理 → 权限管理 → 用户 → 权限`，给 admin 添加例外 `operation.cost.approve`（重新登录生效）
- 数据范围：admin 默认全部省；city_user 强制绑定地市；可直接 URL 访问无权限页 → 403（后端守卫为最终边界）

## 6. 运维操作

| 操作 | 命令/入口 |
|---|---|
| 汇总重算 | 经营分析 → 全库重算（二次确认）；失败范围自动优先 |
| 一致性核对 | 经营分析 → 一致性核对（只告警，不自动改写） |
| 到期预警阈值 | 系统设置 → contract_expiry_warning_days（默认 90 天） |
| 迁移检查 | `pnpm migration-files:check` / `pnpm test:migrations:ledger` |
| 回归测试 | `pnpm test:unit` / `test:architecture` / `test:migrations:ledger` / `test:m2-rbac-auth` / `test:m3-contracts` / `test:m5-offcost` / `test:m6-aggregates` / `test:m7-views`（截图） |

## 7. 回滚

### 7.1 应用回滚
- 前端/后端均保留上一发布版本（dist 目录/容器镜像 tag），切换即可回退；前端资源名带 hash，旧页面缓存自动失效。
- **禁止 amend/force-push 已发布提交**；新提交以追加方式发布。

### 7.2 数据库回滚
- 迁移仅追加、不删除历史迁移文件；如需撤销某迁移，新增"撤销迁移"脚本（先备份，避免破坏 checksum 账本）。
- **回滚前必须备份**：`mysqldump biz_reporting > backup-<date>.sql`；SQLite：复制 .sqlite 文件。
- 数据回滚优先采用"业务级"方式（作废/恢复功能），而非 DDL 逆操作。

## 8. 已知限制（BLK 项）

| ID | 内容 | 状态 |
|---|---|---|
| BLK-1 | 正式非 localhost MySQL 8 gate 已通过；迁移与 M2/M3/M5/M6/M8 集成验证完成 | 已解除 |
| BLK-2 | 旧 facts-v31 测试 Node24 原生崩溃；旧事实工作台已退役隔离并保留风险豁免 | 已缓解 |
| BLK-3 | 非电商订单模板 8 列名变体（当前仅支持电商版 34 列） | 范围外 |
| NEW-M6 | 增量重算为整库重算简化实现（大数据量需按范围优化） | 可延后 |

## 9. super_admin 运维流程（M8 / DEV-066）

| 场景 | 流程 |
|---|---|
| 初始化 | 环境变量注入 `BIZ_SUPER_ADMIN_USERNAME/BIZ_SUPER_ADMIN_PASSWORD`（强密码，≥12 位且非默认）运行 `biz-init-super-admin.mjs`；禁止命令行明文传参；脚本拒绝弱密码（如 123456） |
| 轮换（改密） | 系统管理 → 权限管理 → 用户 → 重置密码（仅 super_admin；生成强随机密码后安全交付）；重置后原密码立即失效 |
| 停用 | 权限管理 → 用户 → 状态 → 禁用；禁用后该账号所有令牌失效、登录返回 401 |
| 审计 | 权限管理 → 操作审计 Tab（GET /biz/admin/operation-logs）：查看创建/重置/停用/作废/审核等操作（操作人/时间/动作/对象/结果） |
| 应急恢复 | ① 密码丢失：在维护窗口使用 `biz-init-super-admin.mjs` 的 env 注入流程；② 唯一 super 被停用：先备份数据库、记录工单与授权人，再由两人复核后执行最小化数据库修复，随后重新登录验证并补记操作审计；③ 汇总异常：经营分析 → 全库重算（失败范围优先） |
| 密钥轮换 | 更换 `JWT_SECRET/AUTH_SECURITY_HMAC_KEY`（生产弱值启动失败）：滚动发布即可，旧令牌过期后自然失效 |
