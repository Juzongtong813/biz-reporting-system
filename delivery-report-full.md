# 经营单元上报系统 — 详细交付报告

## 总览

| 阶段 | 内容 | 状态 | nest build |
|:---:|---|:--:|:--:|
| Phase 1A | Dashboard 后端模块 + 共享类型 | ✅ | 零错误 |
| Phase 1B | Admin Packages 后端模块 | ✅ | 零错误 |
| Phase 1C | Users 缺口补齐 | ✅ | 零错误 |
| Phase 2 | Admin Web 真实后端联调 | ✅ | 零错误 |

**完成日期**：2026-06-11

---

## 一、项目当前架构

```
biz-reporting-system/
├── apps/
│   ├── api/                          # NestJS 后端 (Port 3000)
│   │   ├── src/
│   │   │   ├── auth/                 # 认证 (admin login + wechat login)
│   │   │   ├── users/                # 用户 (me + admin users CRUD)
│   │   │   ├── contracts/            # 合同 CRUD + 跨地市分配
│   │   │   ├── packages/             # 城市端 packages + admin 包管理
│   │   │   ├── dashboard/            # Admin 仪表盘聚合统计
│   │   │   └── common/               # JWT guard, roles guard, entities
│   │   └── .env.local                # SQLite 本地开发配置
│   │
│   └── admin-web/                    # React 18 + Ant Design 5 + Vite (Port 5174)
│       ├── src/
│       │   ├── api/                  # 5 个 API 模块
│       │   ├── components/           # AuthGuard, AdminLayout
│       │   ├── pages/                # Login, Dashboard, Contracts, Packages, Users
│       │   ├── mocks/                # MSW Mock 层
│       │   └── utils/                # Axios 单例, Token 工具
│       └── .env.development          # VITE_ENABLE_MSW=false
│
└── packages/
    ├── shared-types/                 # 共享 TypeScript 类型 (前后端共用)
    └── shared-constants/             # 共享常量 (API_PATHS, 校验规则, 枚举)
```

---

## 二、全部接口清单

### 管理员端 (Admin Web 已联调)

| Method | 路径 | Controller | 权限 | Phase |
|--------|------|-----------|------|:---:|
| `POST` | `/api/auth/admin/login` | AuthController | 公开 | — |
| `GET` | `/api/me` | UsersController | 认证 | — |
| `GET` | `/api/admin/dashboard` | DashboardController | system_admin | 1A |
| `GET` | `/api/admin/contracts` | ContractsController | system_admin | — |
| `POST` | `/api/admin/contracts` | ContractsController | system_admin | — |
| `GET` | `/api/admin/contracts/:id` | ContractsController | system_admin | — |
| `PATCH` | `/api/admin/contracts/:id` | ContractsController | system_admin | — |
| `DELETE` | `/api/admin/contracts/:id` | ContractsController | system_admin | — |
| `GET` | `/api/admin/contracts/:id/allocations` | ContractsController | system_admin | — |
| `GET` | `/api/admin/packages` | AdminPackagesController | system_admin | 1B | `PaginatedResponse<AdminPackageItem>` |
| `POST` | `/api/admin/packages/:id/return-to-draft` | AdminPackagesController | system_admin | 1B |
| `POST` | `/api/admin/packages/:id/unlock-months` | AdminPackagesController | system_admin | 1B |
| `POST` | `/api/admin/packages/:id/open-current-month-contract` | AdminPackagesController | system_admin | 1B |
| `GET` | `/api/admin/users` | AdminUsersController | system_admin | 1C |
| `PATCH` | `/api/admin/users/:id/status` | AdminUsersController | system_admin | 1C |

### 城市端 (Mini Program 待实现)

| Method | 路径 | Controller | 权限 |
|--------|------|-----------|------|
| `POST` | `/api/auth/wechat/register` | AuthController | 公开 |
| `POST` | `/api/auth/wechat/login` | AuthController | 公开 |
| `GET` | `/api/city/packages/current` | PackagesController | city_user |
| `GET` | `/api/city/packages/:id/months/:month` | PackagesController | city_user |
| `GET` | `/api/city/packages/:id/read-only-months/:month` | PackagesController | city_user |
| `POST` | `/api/city/packages/:id/draft-save` | PackagesController | city_user |
| `POST` | `/api/city/packages/:id/submit-preview` | PackagesController | city_user |
| `POST` | `/api/city/packages/:id/submit` | PackagesController | city_user |

---

## 三、Phase 1A — Dashboard 模块

### 新建文件 (4)

| 文件 | 说明 |
|------|------|
| `packages/shared-types/src/common/dashboard.dto.ts` | `DashboardStats` DTO（联调过渡版，⚠️ 标注） |
| `apps/api/src/dashboard/dashboard.module.ts` | 注入 CityEntity + ContractEntity + MonthSnapshotEntity |
| `apps/api/src/dashboard/dashboard.service.ts` | `getStats()` — cities 基线聚合查询 |
| `apps/api/src/dashboard/dashboard.controller.ts` | `GET /api/admin/dashboard`，SYSTEM_ADMIN |

### 修改文件 (4)

| 文件 | 改动 |
|------|------|
| `packages/shared-types/src/index.ts` | 新增 `export type { DashboardStats }` |
| `apps/api/src/app.module.ts` | 注册 `DashboardModule` |
| `apps/admin-web/src/api/dashboard.api.ts` | 删除本地定义，改为 `import from shared-types` |
| `apps/admin-web/src/mocks/data.ts` | import 来源同步切换 |

### 指标口径

```
totalCities:           COUNT(cities)
totalContracts:        COUNT(contracts) WHERE is_deleted = 0
reportedThisMonth:     COUNT(DISTINCT city_id) FROM month_snapshots WHERE belong_month=当前月
overdueNotSubmitted:   totalCities - reportedThisMonth
```

---

## 四、Phase 1B — Admin Packages 模块

### 新建文件 (3)

| 文件 | 说明 |
|------|------|
| `packages/shared-types/src/package/admin-package.dto.ts` | `AdminPackageItem` DTO（cityName + 月度上下文） |
| `apps/api/src/packages/admin-packages.controller.ts` | 4 端点：列表 + 退回 + 解锁 + 开放合同 |

### 修改文件 (5)

| 文件 | 改动 |
|------|------|
| `packages/shared-types/src/index.ts` | 新增 `export type { AdminPackageItem }` |
| `packages/shared-constants/src/index.ts` | `API_PATHS` 补 `ADMIN_PACKAGES` |
| `apps/api/src/packages/packages.service.ts` | +4 admin 方法，注入 AllocationEntity + CityEntity |
| `apps/api/src/packages/packages.module.ts` | 注入新 entity + 注册 AdminPackagesController |
| `apps/admin-web/src/api/packages.api.ts` | 删占位标注，类型切为 `AdminPackageItem` |

**返回契约统一**：Controller 和 Service 均返回 `PaginatedResponse<AdminPackageItem>`（`packages.service.ts` L445），前端从 shared-types 导入同一类型。
| `apps/admin-web/src/mocks/data.ts` | `mockPackages` → `mockAdminPackageItems` |
| `apps/admin-web/src/mocks/handlers.ts` | 对接新结构 + return-to-draft handler |
| `apps/admin-web/src/pages/Packages/index.tsx` | 表格展示城市名、当月状态、累计进度；monthNo 动态取当前月 |

### `openCurrentMonthContract` 关键规则（代码已落地）

```
packages.service.ts L584:
  if (pkg.reportYear !== currentYear || dto.monthNo !== currentMonth) → 400

1. 年份 + 月份双校验: 任一不满足 → 400
   "openCurrentMonthContract 仅支持当前月（${currentYear}年${currentMonth}月）。
    历史月份修正请使用 unlock-months 接口。"
2. 合同归属校验:  查 contract_city_allocations → 不存在 → 400
3. 幂等性:       已开放 → 200 提示，不重复写库
4. 接口职责边界: 仅当月新增合同补录，历史月份统一走 unlock-months
```

---

## 五、Phase 1C — Users 缺口补齐

### 新建文件 (1)

| 文件 | 说明 |
|------|------|
| `apps/api/src/users/admin-users.controller.ts` | `GET /api/admin/users` + `PATCH /:id/status` |

### 修改文件 (4)

| 文件 | 改动 |
|------|------|
| `packages/shared-types/src/user/user.dto.ts` | `UserListItem` 补 `role`；`UserListResponse` 补分页字段 |
| `apps/api/src/users/users.service.ts` | +`list()` (findAndCount) + `updateStatus()` |
| `apps/api/src/users/users.module.ts` | 注入 `CityEntity` + 注册 `AdminUsersController` |
| `apps/admin-web/src/mocks/data.ts` | 6 条 mock 用户补 `role` |

### `UserListItem` 完整字段

```
id, role, name, cityId, cityName, status, registerAt, lastLoginAt
```

---

## 六、Phase 2 — Admin Web 真实后端联调

### 联调前环境修复

| 问题 | 修复 |
|------|------|
| shared-types/constants `package.json` 的 `main` 指向源码 → 运行时 ESM 解析失败 | 改为 `dist/index.js` |
| AuthModule 未注入 UserEntity Repository → JwtStrategy 无法解析 | `TypeOrmModule.forFeature([UserEntity])` |
| UsersService.list() 使用 `getRawMany()` → SQLite 下 key 名不一致 → 500 | 改为 `findAndCount` + 手动 cityName |
| 本地无 MySQL → 无法启动 | `.env.local` + `DB_TYPE=sqlite` + TypeORM 动态切换 |

### 逐页验证结果

| 页面 | 接口 | 状态 | 响应验证 |
|------|------|:--:|------|
| Login | `POST /api/auth/admin/login` | ✅ 200 | `{token, user:{id,role,name,cityId}}` |
| Dashboard | `GET /api/admin/dashboard` | ✅ 200 | `{totalCities, totalContracts, reportedThisMonth, overdueNotSubmitted}` |
| Contracts | `GET /api/admin/contracts` | ✅ 200 | `{items:[], total, page, pageSize}` |
| Packages | `GET /api/admin/packages` | ✅ 200 | `{items:[], total, page, pageSize}` |
| Users | `GET /api/admin/users` | ✅ 200 | `{items:[{id,role,name,cityId,cityName,...}], total, page, pageSize}` |

### 构建验证

| 目标 | 结果 |
|------|:--:|
| `shared-types` tsc | ✅ |
| `shared-constants` tsc | ✅ |
| `apps/api` nest build | ✅ |
| `apps/admin-web` vite dev | ✅ |
| `apps/admin-web` vite build | ⚠️ P2：CJS re-export 不兼容（仅影响生产构建，dev 正常） |

---

## 七、状态总结

```
Admin Web:         ✅ 5 页面可用骨架 + MSW Mock + 真实后端联调
后端 API:          ✅ 15 个管理员端点 + 7 个城市端点
共享契约:          ✅ shared-types + shared-constants 单一真相源
Mini Program:      ⬜ 待启动
```

### 下一步

1. Mini Program 骨架开发（前期调研 + 计划输出）
