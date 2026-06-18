# Phase 1A 交付报告 — Dashboard 模块

## 交付概况

- **Phase**：1A — Dashboard 后端模块 + 共享类型 + 前端类型同步
- **状态**：完成，`nest build` 零错误
- **文件变动**：4 新建 + 4 修改 = 8 个文件

---

## 文件清单

### 新建 (4)

| # | 文件 | 说明 |
|---|------|------|
| 1 | `packages/shared-types/src/common/dashboard.dto.ts` | `DashboardStats` DTO，联调过渡版，标注 ⚠️ |
| 2 | `apps/api/src/dashboard/dashboard.module.ts` | 注入 CityEntity + ContractEntity + MonthSnapshotEntity |
| 3 | `apps/api/src/dashboard/dashboard.service.ts` | `getStats()` 聚合查询，口径以 cities 为基线 |
| 4 | `apps/api/src/dashboard/dashboard.controller.ts` | `GET /api/admin/dashboard`，SYSTEM_ADMIN 角色 |

### 修改 (4)

| # | 文件 | 改动 |
|---|------|------|
| 5 | `packages/shared-types/src/index.ts` | 新增 `export type { DashboardStats }` |
| 6 | `apps/api/src/app.module.ts` | 注册 `DashboardModule` |
| 7 | `apps/admin-web/src/api/dashboard.api.ts` | 删除本地 `DashboardStats` 定义，改为 `import from @biz-reporting/shared-types` |
| 8 | `apps/admin-web/src/mocks/data.ts` | `DashboardStats` import 来源同步切换 |

---

## 指标口径

| 指标 | 公式 | 数据源 |
|------|------|--------|
| 地市总数 | `COUNT(cities)` | cities 表 |
| 合同总数 | `COUNT(contracts) WHERE is_deleted=0` | contracts 表 |
| 本月已提交地市数 | `COUNT(DISTINCT city_id) WHERE belong_month=当前月` | month_snapshots 表 |
| 逾期未提交地市数 | `totalCities - reportedThisMonth` | 计算值 |

**关键约束**：以 `cities` 为基线，不做 `annual_report_packages` 存在性过滤。标注为「联调过渡版」。

---

## 验证

| 检查项 | 结果 |
|--------|:--:|
| `nest build`（api 目录） | ✅ 零错误 |
| Admin Web dev server (:5174) | ✅ HTTP 200 |
| `DashboardStats` 类型来源 | ✅ 统一来自 `@biz-reporting/shared-types` |
| 前端本地类型残留 | ✅ 已清除（`dashboard.api.ts` 无本地定义，`data.ts` import 已切换） |

---

## 遗留标注

- 指标口径为**联调过渡版**，`dashboard.dto.ts` 文件头已标注 ⚠️，待冻结管理端指标方案后替换
- Admin Web Dashboard 页面类型注释同步更新为「联调过渡版」
