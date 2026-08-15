# M7 前端收口与页面完善里程碑报告

> 项目：维护管理经营数据中台
> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 报告日期：2026-08-15
> 阶段：M7「前端收口与页面完善」
> 结论：**M7 完成（SQLite 全验证 + 桌面/移动截图验证通过）；真实 MySQL 验证仍 BLOCKED（BLK-1）**

---

## 1. 已完成任务 ID

| 任务 | 交付物 | 状态 |
|---|---|---|
| DEV-056 | `/biz/` 成为默认入口（根路径重定向 /#/biz/login）；旧入口保留（/#/login 与旧工作台加废弃 Banner，不物理删除） | ✅ |
| DEV-057 | 统一布局 BizLayout（侧边菜单 + 顶部用户 + 移动抽屉）；经营管理六入口（合同/订单/完工/成本/分析/设置）+ 系统管理（设置/权限管理）按权限过滤 | ✅ |
| DEV-058 | 系统管理页完善：用户/角色字典/模块字典/权限点 4 Tab | ✅ |
| DEV-059 | 前端权限控制：useBizPermission hook + BizAdmin 页面级 403 门控 + BizOrders 上传区门控 + 菜单按权限码过滤（后端守卫仍为最终边界） | ✅ |
| DEV-060 | 部署配置：Vite base 相对路径 './'；.env.production 收口 VITE_API_BASE_URL=/api（可配）；proxy 目标可配 | ✅ |
| DEV-061 | 旧页面废弃标记（LegacyBanner：登录页与旧工作台顶部提示；不删除旧代码） | ✅ |
| DEV-062 | test:m7-views 截图验证：桌面 1440x900 + 移动 390x844 共 19 张截图；无水平溢出；city_user 菜单隐藏 + 直接 URL 403 | ✅ |
| DEV-063 | 部署与运行手册 docs/baseline/M7-runbook.md（SQLite→MySQL、迁移、env、初始化管理员、回滚） | ✅ |

## 2. 修改文件

### 新增（6）
- `apps/admin-web/src/components/biz/BizLayout.tsx`（统一布局）
- `apps/admin-web/src/components/biz/BizPerm.tsx`（按钮级权限组件）
- `apps/admin-web/src/utils/biz-permission.ts`（useBizPermission hook + me 权限缓存）
- `scripts/test/m7-views.mjs`（截图验证）
- `docs/baseline/M7-runbook.md`（运行手册）
- `docs/baseline/screenshots/`（19 张截图）

### 修改（6）
- `apps/admin-web/src/App.tsx`（嵌套路由 + 默认入口 + LegacyBanner）
- `apps/admin-web/src/pages/biz/BizAdmin.tsx`（4 Tab + 403 门控）
- `apps/admin-web/src/pages/biz/BizOrders.tsx`（上传区权限门控）
- `apps/admin-web/src/pages/biz/`（6 页面：Table 横向滚动 + 响应式 Col + Space wrap，修复移动端溢出）
- `apps/admin-web/vite.config.ts`（base './'）+ `.env.production`（API 基址收口）
- `package.json`（test:m7-views）

## 3. 数据库迁移

M7 无新增迁移（15 个迁移保持）。

## 4. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build`（4 包） | ✅ |
| unit(20) / architecture / ledger(15) / m2 / m3 / m5 / m6 / auth-v3 / exports / metrics / storage | ✅ 全回归 |
| **`pnpm test:m7-views`**（新增） | ✅ 桌面+移动截图、无溢出、权限验证 |
| `pnpm test:migrations:mysql` | ⛔ BLOCKED（BLK-1） |

**验收要点**：
- 默认入口：根路径 → /#/biz/login；旧 /#/login 保留并显示废弃提示
- 六入口导航：合同/订单/完工/成本/分析/设置 + 系统管理，按权限码过滤（city_user 无"权限管理"菜单）
- 前端权限：BizAdmin 无权限 → 403 结果页；BizOrders 无上传权限 → 隐藏上传区；**直接 URL /#/biz/admin（city_user）→ 403**（后端守卫最终边界）
- 移动端无溢出：修复 4 页（Table scroll / 响应式 Col / Space wrap）
- 截图 19 张（9 页 × 2 视口 + city-403）

## 5. 未解决问题

| ID | 内容 | 影响 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 不可用；脚本已更新（15 迁移）待执行 | M1-M7 真实 MySQL 验证 |
| BLK-2 | facts-v31 测试 Node24 原生崩溃 + 外部参考数据 | 旧事实工作台（M8 退役） |
| BLK-3 | 非电商订单模板 8 列名变体 | 已确认"仅电商版 34 列" |
| NEW-M6 | 增量重算为整库重算简化实现 | 大数据量优化可延后 |

## 6. 下一里程碑（M8 收口与退役）计划

1. **DEV-064** 生产配置审计（.env.production 公网 URL、JWT 密钥、HMAC 密钥占位与警告）
2. **DEV-065** 旧体系退役：旧事实工作台（facts）、报表包（packages）、AI（ai）模块标记废弃/只读（不删除代码，入口隐藏）
3. **DEV-066** super_admin 运维流程收口（初始密码 env、重置流程、操作审计查看）
4. **DEV-067** 迁移至生产 MySQL 的完整验证脚本执行（BLK-1 解除后）
5. **DEV-068** 最终回归与发布检查（release:integrity:gate、全套测试、截图复核）

**M8 前置**：M7 已收口前端入口/部署配置/运行手册；BLK-1（隔离 MySQL）到位后补跑 M1-M7 真实 MySQL 验证。
