# Admin Web 交付报告 v2 — 3 项修复完成

## 修改文件清单

| # | 文件 | 修改内容 | 行号关键证据 |
|---|------|---------|-------------|
| 1 | `src/mocks/handlers.ts` | ①新增 `PackageStatus` + `ReturnToDraftRequest` import ②新增可变 `packages` 数组 ③新增 `return-to-draft` handler ④GET 改用可变数组 | L10-27 新增 imports + packages 变量；L196-218 新增 return-to-draft handler |
| 2 | `src/api/packages.api.ts` | 文件头部增加 ⚠️ 前端占位说明，明确标注两个接口后端均未实现 | L1-10 新增占位说明注释；L24 L31 ⚠️ 标注 |
| 3 | `src/api/dashboard.api.ts` | `pendingReview` → `overdueNotSubmitted`，文件头部标注类型为临时前端占位 | L10-14 占位说明；L20 字段改名 |
| 4 | `src/mocks/data.ts` | `mockDashboardStats` 中 `pendingReview: 4` → `overdueNotSubmitted: 4` | L419 |
| 5 | `src/pages/Dashboard/index.tsx` | `ClockCircleOutlined` → `WarningOutlined`；label `待审核` → `逾期未提交`；文件头注释标注后端未实现 | L1-4 注释；L7-12 icon import；L49-54 stat 卡片 |

---

## Fix 1：Packages 页面 return-to-draft 已可用

**修改文件**：`src/mocks/handlers.ts`

**新增 handler**：
```
POST /api/admin/packages/:packageId/return-to-draft
→ 接受 { monthNo: number; reason: string }
→ 将 packages[id].status 改为 PackageStatus.DRAFT
→ 更新 lastUpdatedAt / updatedAt
→ 返回 { success: true }
```

**证据**（handlers.ts L196-218）：
```typescript
http.post('/api/admin/packages/:packageId/return-to-draft', async ({ params, request }) => {
  const id = Number(params.packageId);
  const body = (await request.json()) as ReturnToDraftRequest;
  const idx = packages.findIndex((p) => p.id === id);
  if (idx === -1) {
    return HttpResponse.json({ code: 404, message: '报表包不存在' }, { status: 404 });
  }
  packages[idx] = {
    ...packages[idx],
    status: PackageStatus.DRAFT,
    lastUpdatedAt: new Date(),
    updatedAt: new Date(),
  };
  return HttpResponse.json({ success: true });
}),
```

同时将 GET handler 从 `mockPackages`（不可变）改为 `packages`（可变），确保退回操作后列表可即时刷新。

---

## Fix 2：Packages 页面明确标注为前端占位

**修改文件**：`src/api/packages.api.ts`

**关键声明**（packages.api.ts L1-10）：
```
⚠️ 前端占位说明：
- GET /api/admin/packages — 后端尚未实现此端点（当前仅有 city/packages 城市端）
- POST /api/admin/packages/:id/return-to-draft — 后端已冻结在 API_PATHS 中，
  对应的 admin controller 方法尚未创建

当前这些接口仅在 Mock 模式下可用（MSW handler 提供占位数据），
切换到真实后端后需要后端先补齐接口 + 更新 OpenAPI。
```

**真实后端状态**：
- `packages.controller.ts` 位于 `@Controller('city/packages')` → 城市端，非 admin
- `API_PATHS` 中有 `ADMIN_PACKAGE_RETURN_TO_DRAFT` / `ADMIN_PACKAGE_UNLOCK_MONTHS` / `ADMIN_PACKAGE_OPEN_CURRENT_CONTRACT` 三个常量路径
- 后端 `app.module.ts` 仅注册了 `PackagesModule`（即 city 端），无 admin packages controller
- `GET /api/admin/packages` 在后端契约中完全不存在

---

## Fix 3：Dashboard 指标语义修正 + 类型来源收敛

**修改文件**：`src/api/dashboard.api.ts` + `src/mocks/data.ts` + `src/pages/Dashboard/index.tsx`

### 指标修正

| 修改前 | 修改后 | 原因 |
|--------|--------|------|
| `待审核` | `逾期未提交` | 本项目无审核流 |
| `pendingReview` | `overdueNotSubmitted` | 字段名同步修正 |
| `ClockCircleOutlined` | `WarningOutlined` | 图标语义更准确 |

**证据**（Dashboard/index.tsx L7-12, L49-54）：
```typescript
// L7-12: import
import { WarningOutlined } from '@ant-design/icons';
// L49-54: stat card
{
  title: '逾期未提交',
  value: data?.overdueNotSubmitted ?? '-',
  icon: <WarningOutlined style={{ fontSize: 36, color: '#faad14' }} />,
  color: '#fffbe6',
},
```

### 类型来源标注

**dashboard.api.ts L10-14**：
```
⚠️ 类型来源说明：
DashboardStats 是前端临时占位类型，shared-types 中暂无对应 DTO。
后端 dashboard 目录为空，GET /api/admin/dashboard 尚未实现。
待后端补齐后应：
  1. 在 shared-types 中定义 DashboardStats DTO
  2. 本文件改为从 shared-types 导入，删除本地定义
```

---

## 页面 Mock 独立运行状态（修正后）

| 页面 | 纯 Mock 可运行 | 仍依赖后端接口 | 说明 |
|------|:---:|:---:|------|
| `/login` | ✅ | — | 登录页 + Auth，MSW handler 完整 |
| `/admin/dashboard` | ✅ | ⚠️ 后端未实现 | Mock 显示 4 卡片；类型为临时定义 |
| `/admin/contracts` | ✅ | — | 列表 + CRUD + 分配，全部对齐后端契约 |
| `/admin/packages` | ✅ | ⚠️ 后端未实现 | 列表 + 退回草稿 Mock 跑通，但接口标注为占位 |
| `/admin/users` | ✅ | — | 列表 + 启用/禁用，对齐 shared-types |

**精确说明**：
- **3 个页面**（login、contracts、users）接口完全对齐后端已冻结契约
- **2 个页面**（dashboard、packages）Mock 模式可运行但接口为前端占位，需后端补齐后联调

---

## 约束遵守确认（不变）

| # | 约束 | 状态 |
|---|------|:---:|
| 1 | Mock 只模拟后端，不自创字段 | ✅（占位接口已明确标注） |
| 2 | 不额外引 Zustand | ✅ |
| 3 | 先做可用骨架 | ✅ |
| 4 | MSW 一键切真实接口（VITE_ENABLE_MSW） | ✅ |
