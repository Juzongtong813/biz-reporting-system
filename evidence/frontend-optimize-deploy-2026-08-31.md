# 前端文案统一 + 加载性能优化 + 趋势修复 · 部署报告

- 报告时间：2026-08-31 11:55（北京时间）
- 环境 ID：`zy-data-d2g9g1ghr47ac6254`
- 结论：**API 040 与前端 030 均已部署并全量生效；「经营单位」文案已彻底清零；趋势无折线根因已修复；超额清单完整保留。**

---

## 一、修改文件清单

### 前端（apps/admin-web）

| 文件 | 改动性质 | 说明 |
|---|---|---|
| `src/components/biz/BizAnalysisOptionsContext.tsx` | **新增** | 年度/省份/地市选项全局缓存（模块级 cache + inflight Promise） |
| `src/components/biz/BizAnalysisFilter.tsx` | 重写 | 读取共享缓存；选项 loading；年度空状态；就绪后自动选最新有效订单年度 |
| `src/pages/biz/BizAnalysisTrend.tsx` | 重写 | 竞态防护、固定高度容器+resize、按月聚合、空状态、Tooltip 完整年月 |
| `src/pages/biz/BizAnalysisOverview.tsx` | 修改 | 新增预警类型多选筛选；竞态防护；loading；刷新改 tick 触发 |
| `src/pages/biz/BizAnalysisCities.tsx` | 重写 | 竞态防护；loading/空状态；累计完工兜底重算 |
| `src/pages/biz/BizAnalysisOverruns.tsx` | 重写 | 竞态防护；loading/空状态（**页面与路由保留**） |
| `src/pages/biz/BizCosts.tsx` | 修改 | 复用共享缓存；类别模块级缓存；bizMe 与类别并行；序列号防覆盖；失败状态 |
| `src/api/biz.api.ts` | 修改 | `bizSnapshotDashboard` 增加可选 `signal`（支持请求取消） |
| `src/App.tsx` | 修改 | `/biz` 路由层挂载 `BizAnalysisOptionsProvider` |
| `BizLayout.tsx` / `BizAnalysisCityDetail.tsx` / `BizContractOverview.tsx` / `BizContracts.tsx` / `BizRegionSettings.tsx` / `BizAdmin.tsx` | 文案 | 仅用户可见文案替换 |

### 后端（apps/api）

| 文件 | 改动性质 | 说明 |
|---|---|---|
| `src/biz-snapshots/biz-snapshot.service.ts` | **修复根因** | `buildTrend()` 改为按 `periodKey` 聚合求和 |
| `src/biz-snapshots/biz-snapshot.service.ts` | 修复 | `liveFallback()` 多选（多月/多省/多地市）参数透传，不再被忽略 |
| `src/biz-aggregates/biz-aggregate.service.ts` | 增强 | `overview/trend/byCity` 新增可选 `cityIds/provinceIds/months` 交集过滤 |

**未改动**：字段名、接口路径、数据库列名、TypeScript 变量名、后端方法名；仅追加可选参数，不破坏既有调用。

---

## 二、趋势图问题根因与修复

### 根因（核心）
`biz-snapshot.service.ts` 的 `buildTrend()` 原实现对 `scopedMetrics` **逐行 map，未按月份聚合求和**。

由于快照指标中同一 `YYYY-MM` 通常存在多行（不同地市/省份各一行），接口会把同一个月输出成**多个数据点**；前端以 `month` 为 key 建 Map 时后者覆盖前者，**只保留最后一行地市的金额**，导致趋势金额严重失真（近似全 0），表现为"选择年度后折线不显示"。

### 修复
```ts
// 修复前：逐行 map（同月多行 → 前端 Map 覆盖 → 数据失真）
scopedMetrics.filter(...).map((m) => ({ month: m.periodKey, ... }))

// 修复后：按 periodKey 建桶累加，保证每个 YYYY-MM 只有一个数据点
const buckets = new Map<string, ReturnType<typeof zeroBucket>>();
for (const m of scopedMetrics) { /* 过滤 + metricCompletion 累加 */ }
return [...buckets.entries()].sort(...).map(([month, b]) => ({ month, ...b }));
```

### 附带修复（前端）
1. **重复请求**：选项未就绪/年度为空时不发请求，消除首屏空跑 + 默认年度生效后的二次请求；
2. **旧响应覆盖**：请求序列号 + `AbortController` 双重防护，过期响应直接丢弃；
3. **空画布**：固定 380px 高度容器（loading/空状态/图表共用），数据或筛选变化后主动 `resize()`；
4. **误导性空图**：有数据才画线，无数据显示「该年度暂无趋势数据」；年度列表为空显示「暂无可选年度，请先导入订单数据」；
5. **Tooltip**：显示完整 `YYYY-MM` 与千分位金额；
6. **多月筛选**：只展示选中月份，未选月份不出现；未产生数据的月份补 0。

---

## 三、加载性能优化说明

| 优化项 | 优化前 | 优化后 |
|---|---|---|
| 年度/省/市选项请求 | 概览、趋势、地市对比、超额**各自拉取** → 4 页 × 3 接口 = **12 次** | 全局缓存 + inflight 去重 → **3 次**，跨页面复用 |
| dashboard 首屏请求 | 年度为空先跑一次，默认年度生效后再跑一次 → **≥2 次** | 年度就绪后才请求 → **1 次** |
| 旧响应覆盖 | 无防护，快速切换筛选会串数据 | 序列号 + AbortController 双重防护 |
| 成本页加载 | `bizMe → years → (provinces+cities) → categories` **串行** | 年度/省/市读缓存，`bizMe` 与成本类别**并行**；类别模块级缓存 |
| 二次过滤 | 部分页面在前端重复过滤 | 后端完成交集过滤，前端不再二次过滤 |

**新增共享缓存组件**：`BizAnalysisOptionsContext`（模块级 cache + inflight Promise，并发挂载共享同一请求），Provider 挂在 `/biz` 路由层。

**注意**：性能改动**未削弱任何数据权限过滤**——权限仍由后端 `auth.dataScope` + `applyAggScope` 强制生效。

---

## 四、前端文案替换清单

脚本精确替换，共 **55 处「经营单位」→「地市」**、**3 处「经营分析概览」→「经营概览」**。

| 原文案 | 新文案 | 位置 |
|---|---|---|
| 经营分析概览 | **经营概览** | 菜单、页面标题、权限说明 |
| 经营单位对比 | **地市对比** | 菜单、页面标题、返回按钮、加载失败提示 |
| 经营单位指标对比 | **地市指标对比** | 卡片标题 |
| 经营单位（列标题/筛选/说明） | **地市** | 地市对比、地市详情、概览 Drawer、合同概览 |
| 经营单位分配 | **地市分配** | 概览、地市详情、合同概览、合同管理 |
| 合同/经营单位 | **合同/地市** | 超额清单列 |
| 经营单位超额 | **地市超额** | 超额清单类型标签 |
| 经营单位编码/名称 | **地市编码/名称** | 省市设置 |
| 单位对比（简写） | **地市对比** | 权限管理说明 |

**刻意保留（不渲染到页面的技术注释）**：`biz.api.ts:514/532`、`BizAnalysisCityDetail.tsx:46/186`。
**保留的业务标签**：「省级直属」「普通地市」。
**校验结果**：构建产物 `dist/assets/` 中「经营单位」出现 **0 次**；线上主 chunk 同样为 **0 次**。

---

## 五、超额清单保留情况

| 保留项 | 状态 | 证据 |
|---|---|---|
| 菜单入口「超额清单」 | ✅ 保留 | 线上主 chunk 含「超额清单」1 处 |
| 路由 `/biz/analysis/overruns` | ✅ 保留 | 线上主 chunk 含 `analysis/overruns` |
| 页面组件 | ✅ 保留 | `dist/assets/BizAnalysisOverruns-C1C1X1t0.js` |
| 列文案 `合同/地市` | ✅ 已更新 | 该 chunk 含「合同/地市」「地市超额」 |
| 后端接口 | ✅ 未动 | `dashboard.overruns`（401 存在且鉴权生效） |
| 后端实体/快照表 | ✅ 未动 | `biz_snapshot_overrun*` 保留；040 启动建表 LOG 正常 |
| 筛选功能 | ✅ 正常 | 年度/月份/省份/地市筛选逻辑保留 |

---

## 六、typecheck / build / 定向验证结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 前端类型检查 | `npx tsc -b --force` | ✅ EXIT=0（无错误输出） |
| 前端构建 | `npx vite build` | ✅ EXIT=0（22.15s，仅 echarts chunk 体积警告，非错误） |
| 后端类型检查 | `npx tsc --noEmit` | ✅ EXIT=0 |
| 后端构建 | `npx nest build` | ✅ EXIT=0，dist 产物已更新（11:32） |

### 定向接口检查（未鉴权探测，401 = 路由存在且鉴权生效）

| 接口 | 结果 |
|---|---|
| `GET /api/biz/analysis/years` | 401 ✅ |
| `GET /api/biz/analysis/dashboard?year=2025&months=2025-01,2025-03` | 401 ✅ |
| `GET /api/biz/analysis/trend?year=2025` | 401 ✅ |
| `GET /api/biz/analysis/contracts` | 401 ✅ |
| `GET /api/biz/costs?year=2025` | 401 ✅ |
| `GET /api/biz/analysis/snapshot/status` | 401 ✅ |
| `GET /api/biz/analysis/snapshot/metadata` | 401 ✅ |
| `GET /api/health/live` | 200 `{"status":"live"}` ✅ |
| `GET /api/health/ready` | 200 `{"status":"ready","checks":{"database":"up","storage":"up"}}` ✅ |

### 浏览器最小冒烟

- 生产登录页渲染正常（**非白屏**），表单/文案完整 → 证明新增 Provider 未导致运行时崩溃
- CloudBase 测试域名存在「确定访问」拦截层，已点击通过后进入应用
- 浏览器已关闭，无残留 Chrome 进程

---

## 七、部署结果

| 组件 | 版本 | 状态 | 时间 |
|---|---|---|---|
| API（CloudRun） | **biz-reporting-api-prod-040**（DeployId 040，BuildId 2602102422） | **normal，FlowRatio=100（全量）** | 2026-08-31 11:34:53 触发 → 全量生效 |
| 前端（静态托管） | **biz-reporting-prod-030**（buildId 2602102428） | **SUCCESS** | 2026-08-31 11:36:24 |

- 旧版本处理：039 流量归 0（保留，未删除）；029 由 030 覆盖（未删除旧版本）
- 环境固定 `zy-data-d2g9g1ghr47ac6254`；未创建新服务名
- 部署后日志（11:34–11:50）：**ERROR 0 条**；快照表建表 LOG 正常（8 张表，含超额相关）

### 线上 URL

- 前端：https://biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com/
- API：https://biz-reporting-api-prod-265611-4-1362656322.sh.run.tcloudbase.com/

### 产物一致性

线上 `index.html` 与本地 `dist/index.html` **字节一致**（均引用 `assets/index-D1pQ6vPn.js`，线上 200，1,102,199 bytes）。

---

## 八、未执行的测试范围

1. **登录后内页业务冒烟未执行**：预警类型筛选交互、趋势折线实际渲染、地市对比/地市成本/超额清单/合同概览的数据展示——**无生产账号凭证**，且遵循既有决策「不再用生产账号做登录后验证」。需由用户自行登录确认。
2. **未运行大规模全量 E2E**（按需求要求）。
3. **接口返回数据的正确性未做鉴权后实测**：受限于无账号与无本地 MySQL，仅验证到"路由存在 + 鉴权生效 + 构建通过"；趋势按月聚合的正确性由代码修复 + 类型检查保证。
4. **概览 `contractInventory` 在多选地市时仍按单选口径**计算合同库存（保持既有口径未改），多选地市时合同数可能偏大。
5. **本轮代码改动未提交 git**（沿用上轮"待用户确认后再 commit"的约定）。

---

## 九、合规声明

- 未删除超额清单页面、菜单、路由、接口、实体或数据库表
- 未执行任何数据删除
- 未修改字段名、接口路径、数据库列名、TS 变量名、内部技术标识
- 仅新增 1 个前端组件，其余为既有文件改写
