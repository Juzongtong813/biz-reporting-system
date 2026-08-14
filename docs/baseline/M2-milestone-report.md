# M2 账号、权限与两级门户里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-14
> 阶段：M2「账号、权限与两级门户」
> 结论：**M2 完成（SQLite 全验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-013 | biz 登录安全（bcrypt + HMAC 哈希桶 + 5 次失败锁 15 分钟 + 停用/重置立即失效）；复用 LoginSecurityService | ✅ |
| DEV-014 | 权限合并算法（角色默认 + 账号例外 allow/deny；super_admin 通配 ALL）+ 迁移 012 权限种子（39 权限点 + 48 角色权限） | ✅ |
| DEV-015 | 数据范围解析与守卫（省/地市两级；city_user 强制绑定地市；contract_manager 无业务明细范围） | ✅ |
| DEV-016 | 用户/角色/模块/权限/例外/数据范围管理 API（仅 super_admin）+ 最小操作日志 | ✅ |
| DEV-017 | 一级门户 + 维护管理二级门户 API 与前端路由（无权限 403/隐藏） | ✅ |
| DEV-018 | 工程管理/资产管理/人员管理占位页（建设中，不读取经营数据） | ✅ |
| DEV-019 | 四角色自动化测试（AUTH-001~004/006、PERM-R1~R5、SEC-002/003）+ **api/admin-web typecheck 补齐并纳入 CI** | ✅ |

## 2. 修改文件

### 新增（13）
- 共享层：`packages/shared-types/src/baseline/permissions.ts`（BizModuleCode/BizPermissionCode/ROLE_DEFAULT_PERMISSIONS/SENSITIVE_ORDER_PERMISSION）
- 权限服务：`apps/api/src/rbac/rbac.service.ts`（loadUserAuthContext/assertPermission/assertProvinceScope/assertCityScope）、`rbac.module.ts`
- biz 认证模块：`apps/api/src/biz-auth/`（biz-jwt.strategy.ts、biz-auth.guard.ts、biz-auth.service.ts、biz-auth.controller.ts、biz-permissions.decorator.ts、biz-permissions.guard.ts、biz-scope.decorator.ts、biz-scope.guard.ts、biz-auth-user.decorator.ts、biz-portal.controller.ts、biz-admin.service.ts、biz-admin.controller.ts、biz-auth.module.ts）
- 前端：`apps/admin-web/src/pages/biz/`（BizLogin/BizPortal/BizMaintenancePortal/BizPlaceholder/BizAdmin）+ `api/biz.api.ts` + `utils/biz-auth.ts`
- 迁移：`apps/api/migration/012_biz_permission_seed.sql`
- 脚本：`scripts/auth/biz-init-super-admin.mjs`、`scripts/test/run-m2-rbac-auth.mjs`

### 修改（8）
- `packages/shared-types/src/index.ts`（导出 permissions）
- `apps/api/src/app.module.ts`（注册 BizAuthModule）
- `apps/api/src/auth/login-security.service.ts`（LoginRouteKey 追加 biz_login；LoginAuditDetails.userId 支持 string；biz UUID 审计降级 null）
- `scripts/db/migrate.mjs`（inspectState 012 分支）
- `scripts/db/migration-checksums.json`（追加 012）
- `scripts/test/run-migration-ledger-contract.mjs`（13 迁移 + 权限种子断言）
- `scripts/test/run-migrations-mysql.mjs`（13 迁移，待隔离 MySQL 执行）
- `apps/api/package.json` / `apps/admin-web/package.json` / `package.json`（typecheck 补齐 + 根 typecheck 顺序 + test:m2-rbac-auth + auth:biz-init-super-admin）

## 3. 数据库迁移

| 迁移 | 内容 | 状态 |
|---|---|---|
| 012_biz_permission_seed | 39 权限点（模块-页面-操作）+ 48 角色默认权限（admin 23 / contract_manager 9 / city_user 16）| ✅ SQLite applied |

- super_admin 由服务端通配 ALL（不依赖种子）；seed 幂等可重跑。
- checksum 已追加（012: `79d6285f…`），001-011 未动。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（4 包，NEW-M1 已解决） | ✅ 全通过 |
| `pnpm build`（4 包） | ✅ 全通过 |
| `pnpm test:unit`（20 文件） | ✅ |
| `pnpm test:architecture` | ✅ 0 违规 |
| `pnpm test:migrations:ledger` | ✅ migrations=13 幂等 + 权限种子 |
| `pnpm test:baseline-smoke` | ✅ 回归 |
| **`pnpm test:m2-rbac-auth`**（新增） | ✅ 四角色 + 登录安全 + 数据范围 + 停用失效 |
| `pnpm test:auth-v3` | ✅ 旧体系零回归 |
| `pnpm test:exports-v3` / `metric-sources` / `storage-gate` | ✅ |
| `pnpm migration-files:check` | ✅ 13 迁移 checksum 匹配 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1 隔离 MySQL） |

**M2 验收覆盖**（test:m2-rbac-auth 断言）：
- 登录安全：正确登录 201；连续 5 次失败 401 + 第 6 次正确密码也被锁定（15 分钟）
- 权限合并：super_admin 通配 `['*']`；admin 可见 engineering+maintenance；contract_manager 仅合同域（无 engineering）；city_user 绑定地市
- 三路守卫：未登录 401；无权限 API 403；city_user 传其他地市 ID 数据范围拒绝（403）
- 停用立即失效：停用后旧 token 立即 401（authVersion+1）
- 两级门户：super_admin 见 5 模块；占位模块仅建设中元信息

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；MySQL 迁移/集成测试脚本已更新（13 迁移）待执行 | M1/M2 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台回归（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | M4 已确认"仅电商版 34 列严格匹配"，非电商留待业务确认 |
| NEW-M2 | super_admin 初始密码经环境变量注入（biz-init-super-admin），生产初始化流程待 M8 运维收口 | M8 |

## 6. 下一里程碑（M3 合同域）计划

按基线 09 表 8（DEV-020 ~ DEV-027）：

1. **DEV-020** 合同列表/详情/新增/编辑/资料上传 API（合同号服务端唯一）
2. **DEV-021** 草稿完整性、生效、执行、完成、到期、作废状态机；生效后锁定合同额
3. **DEV-022** 补充合同独立编号/金额/进度/分配/费率 + 可选父合同
4. **DEV-023** 合同地市分配、固定额度合计、预留额度、降低额度、取消分配规则
5. **DEV-024** 合同-地市费率与生效历史；订单/完工入账时获取并保存费率快照
6. **DEV-025** 合同详情聚合 API（基础/地市/额度/费率/进度/明细/超额/预警）
7. **DEV-026** 合同管理页面 + 全屏详情（权限显示编辑/分配/作废动作）
8. **DEV-027** 合同唯一性/状态/并发/额度/费率测试（CON-001~010、STA-001~003）

**M3 前置**：复用 M2 的 biz 权限守卫（operation.contract.*）；金额统一整数分；合同号唯一约束已在 010 迁移建立。
