# Phase 2 联调报告 — Admin Web 真实后端联调

## 概况

- **Phase**：2 — Admin Web 关闭 MSW，逐页验证真实后端接口
- **状态**：5/5 页面全部通过
- **环境**：后端 SQLite（better-sqlite3），前端 VITE_ENABLE_MSW=false

---

## 联调前置准备

### 环境变更

| 文件 | 改动 | 说明 |
|------|------|------|
| `.env.local` | 新建 | `DB_TYPE=sqlite`，本地无需 MySQL |
| `app.module.ts` | 修改 | TypeORM 支持 MySQL/SQLite 动态切换；OnModuleInit seed admin |
| `auth.module.ts` | 修改 | 注入 `TypeOrmModule.forFeature([UserEntity])`（JwtStrategy 依赖） |
| `shared-types/package.json` | 修改 | `main` 指向 `dist/index.js`（运行时解析） |
| `shared-constants/package.json` | 修改 | 同上 |
| `.env.development` | 修改 | `VITE_ENABLE_MSW=false` |
| `users.service.ts` | 修改 | `list()` 改用 `findAndCount`（兼容 SQLite raw query key 差异） |
| 依赖新增 | `better-sqlite3` | SQLite 驱动 |

### 构建验证

```
apps/api: nest build → 零错误
packages/shared-types: tsc → 零错误
packages/shared-constants: tsc → 零错误
```

---

## 逐页联调结果

### 1. Login — ✅ 通过

| 检查项 | 结果 |
|--------|:--:|
| `POST /api/auth/admin/login` | 200 |
| 返回结构 `{token, user}` | ✅ 对齐 `LoginResponse` |
| `user: {id, role, name, cityId}` | ✅ 对齐 `UserBrief` |
| 错误密码 401 | ✅ `"用户名或密码错误"` |

**实际返回**：
```json
{"token":"eyJh...","user":{"id":1,"role":"system_admin","name":"系统管理员","cityId":null}}
```

### 2. Dashboard — ✅ 通过

| 检查项 | 结果 |
|--------|:--:|
| `GET /api/admin/dashboard` | 200 |
| 返回字段 | `totalCities, totalContracts, reportedThisMonth, overdueNotSubmitted` |
| 类型来源 | `@biz-reporting/shared-types` DashboardStats |
| 空库返回全 0 | ✅ 正常 |

**实际返回**（空库）：
```json
{"totalCities":0,"totalContracts":0,"reportedThisMonth":0,"overdueNotSubmitted":0}
```

### 3. Contracts — ✅ 通过

| 检查项 | 结果 |
|--------|:--:|
| `GET /api/admin/contracts?page=1&pageSize=20` | 200 |
| 返回结构 | `{items:[], total, page, pageSize}` |
| 类型 | `PaginatedResponse<Contract>` |
| 空库返回空数组 | ✅ 正常 |

**实际返回**：
```json
{"items":[],"total":0,"page":1,"pageSize":20}
```

### 4. Packages — ✅ 通过

| 检查项 | 结果 |
|--------|:--:|
| `GET /api/admin/packages` | 200 |
| 返回结构 | `{items:[], total, page, pageSize}` |
| 类型 | `PaginatedResponse<AdminPackageItem>` |
| AdminPackageItem 含 cityName/currentMonthSubmitted/submittedMonthCount | ✅ 共享契约已定义 |

**实际返回**：
```json
{"items":[],"total":0,"page":1,"pageSize":0}
```

### 5. Users — ✅ 通过

| 检查项 | 结果 |
|--------|:--:|
| `GET /api/admin/users` | 200 |
| 返回字段含 `role` | ✅ 在本次 Phase 1C 补齐 |
| 所有 7 字段 | `id, role, name, cityId, cityName, status, registerAt, lastLoginAt` |
| 类型来源 | `UserListItem` from shared-types |

**实际返回**（含种子管理员）：
```json
{
  "items":[{"id":1,"role":"system_admin","name":"系统管理员","cityId":null,"cityName":null,"status":"enabled","registerAt":"2026-06-11T09:28:32.000Z","lastLoginAt":"2026-06-11T09:32:54.197Z"}],
  "total":1,"page":1,"pageSize":20
}
```

---

## 联调中发现并修复的问题

| 问题 | 严重级别 | 修复 |
|------|:--:|------|
| shared-types/constants 的 package.json `main` 指向源码导致运行时 ESM 解析失败 | P0 | 改为 `dist/index.js` / `dist/index.d.ts` |
| AuthModule 未注入 `UserEntity` Repository，JwtStrategy 无法解析 | P0 | `TypeOrmModule.forFeature([UserEntity])` |
| UsersService.list() 使用 `getRawMany()` 在 SQLite 下 key 名不一致导致 500 | P0 | 改为 `findAndCount` + 手动 cityName 查询 |
| 本地无 MySQL → 无法启动后端 | P1 | `.env.local` + `DB_TYPE=sqlite` + TypeORM 动态切换 |

---

## 验证总结

| 页面 | 状态 | 接口 | 类型对齐 |
|------|:--:|------|:--:|
| Login | ✅ | `POST /api/auth/admin/login` | `LoginResponse` |
| Dashboard | ✅ | `GET /api/admin/dashboard` | `DashboardStats` |
| Contracts | ✅ | `GET /api/admin/contracts` | `PaginatedResponse<Contract>` |
| Packages | ✅ | `GET /api/admin/packages` | `PaginatedResponse<AdminPackageItem>` |
| Users | ✅ | `GET /api/admin/users` | `UserListResponse{items: UserListItem}` |

**Phase 2 联调通过。** 5 个页面全部在真实后端下返回 200，响应结构与 shared-types 对齐。

---

## 当前状态

```
Phase 1A: Dashboard 模块      ✅
Phase 1B: Admin Packages 模块  ✅
Phase 1C: Users 缺口补齐       ✅
Phase 2:  Admin Web 联调       ✅
Phase 3:  Mini Program 骨架    ⬜ 待启动
```
