# 经营数据中台 · 前端视觉审计摘要（AUDIT）

> 基线分支：`recovery/production-governance-20260803` · 基线提交：`503996a`
> 范围：仅 `apps/admin-web` 的视觉设计 / 信息层级 / 响应式 / 交互反馈优化
> 目标：从"营销落地页风"转为"经营运营工作台"（安静、紧凑、清晰、可扫描、可比较、可连续操作）
> 状态：只读审计完成，尚未改动任何业务代码（除工作树中已存在的 CSV 公式注入中和 CWE-1236 安全补丁，属既有未提交变更，本次优化须保留）

---

## 0. 审计方法与当前工作树状态

- 方法：路由（`App.tsx`）→ 布局（`BizLayout.tsx`）→ 业务页（9 个 `biz/*` 页）→ 全局样式（`App.css` / `main.tsx` ConfigProvider）→ 测试契约（`scripts/test/m7-views.mjs`、`run-m12-interaction.mjs`）全量只读阅读。
- **工作树既有未提交变更（须保护、不得纳入本次提交）**：
  - `docs/baseline/screenshots/admin-desktop.png`、`admin-mobile.png`（用户 baseline 截图，绝对约束 #4）。
  - `apps/admin-web/src/pages/biz/BizAnalysis.tsx`：已含 `escapeCsv` CSV 公式注入中和（CWE-1236 / OWASP DSV），属安全补丁，非视觉范围，本次优化不得删除或削弱。
- 已对三处文件做离线备份（`/e/code2/_protected_bak_20260818/`）并校验 sha256，防止后续测试覆盖。

---

## 1. 五维视觉问题清单

### 维度 A · 视觉基础 / 设计令牌（Visual Foundation）
1. `App.css` 已存在完整 `v3-*` 令牌体系（语义色、8px 间距、紧凑 type scale、暗色侧栏、metric-strip、panel、trend、ratio），但仅服务于**已废弃的旧 AdminLayout**；新基线 `biz/*` 页面**全部使用内联 `style={{}}`**，未复用任何令牌，导致双套视觉并存、难统一。
2. 颜色硬编码散落：指标卡 `#2878b8/#0F766E/#2f9e62/#c47b20/#c64b4b`、页面背景 `#F5F7F8`、边框 `#e8edf0` 等，未进入 ConfigProvider token 或 CSS 变量。
3. `main.tsx` ConfigProvider 已设主色/圆角/Button/Card/Table 基础 token，但 **Drawer / Modal / Tag / Statistic / Segmented 的组件级 token 未系统覆盖**，弹层与统计数字视觉游离。
4. 字号层级靠内联硬编码，无统一 type scale（标题 18~34px、数字 18~20px 混杂）。

### 维度 B · 信息层级（Information Hierarchy）
5. 经营分析页 8 张指标卡 + 9 列地市表，所有数字同字号、同权重，**主指标（净利、超额）未突出**，关键决策信息被淹没。
6. 门户/维护页模块卡片无主次结构，标题与说明等权重；业务页 Header 仅显示菜单名，**无页面标题区（标题+描述+操作分组）**，用户进入深层页后缺乏上下文锚点。
7. 列表页（合同/订单/成本/线下完工）表格列密集，除 hover/zebra 外无视觉锚点；状态标签（Tag）颜色语义分散（成功/警告/危险无集中映射）。
8. 合同详情 Drawer 含 4 个 Tab，但 Tab 间信息密度差异大，缺区块标题与"返回列表"锚点。

### 维度 C · 响应式布局（Responsive Layout）
9. `App.css` 断点（1180/900/640）仅作用于旧 AdminLayout；`biz/*` 页面用 `Row/Col` 固定 gutter + 固定 `Sider width=208`，移动端只靠 `BizLayout` Drawer 切换，业务页内部**网格在 ≤640 时 xs=24 单列但间距/字号未降级**，留白过大、信息密度低。
10. 登录页双栏 + 全屏背景图，移动端左品牌面板压缩而非隐藏，文字重叠风险（≤760 才单列）。
11. 经营分析页筛选区（月份/地市/清空/导出/返回/核对/重算/刷新 8 个控件）在窄屏**未换行堆叠、按钮挤压**；趋势表在移动端横向溢出无降级。
12. 表格移动端横向滚动，但无首列冻结、无紧凑密度，可扫描性差。

### 维度 D · 交互视觉反馈（Interaction & Feedback）
13. 筛选/清空/导出为裸 `Button`，**导出无 loading/成功反馈**（直接 `a.click()`），用户无确认感；CSV 下载无 toast。
14. 侧栏菜单选中态仅 antd 暗色默认高亮，**无左侧激活指示条/激活背景强化**；移动端 Drawer 关闭后无焦点回归。
15. 列表行 hover → 进入 Drawer（width 720 / 92%）**无过渡强调**；表单提交、上传（`Upload.Dragger`）缺 success/error 视觉态。
16. 密码重置 Modal、合同作废 `Modal.confirm`（Select+Input）组合**未做视觉分组**；全局无统一空状态（Empty）/加载骨架（Skeleton）风格。

### 维度 E · 一致性 / 复用（Consistency & Reuse）
17. 列表页（合同/订单/成本/线下完工/账号）各自重复"Card 包裹 Table + 顶部筛选/操作"结构，但间距、标题样式、按钮样式**不统一**（有的用 `Space`、有的内联）。
18. 卡片标题无统一组件；状态色映射（A/B/C/D 等级、完成/驳回/作废）**无集中常量**，散落各页。
19. 桌面 Drawer（720px）与移动 Drawer（92%）宽度差异大但内部布局未适配；缺共享"页面容器 / 页头 / 区块标题"组件，每页重复样板。
20. 登录页为营销双栏 + 全屏图，与其余业务页的"安静工作台"基调割裂，需收敛为单栏居中。

---

## 2. 设计改造范围（A–E）

### A. 全局视觉基础（复用并扩展既有 `v3-*` 令牌，不另起炉灶）
- **扩展 `App.css`**：在 `v3-*` 体系上新增 `biz` 工具层——状态语义色（`--v3-tag-success/warn/danger/info` + 等级 A/B/C/D）、页面容器（`.v3-page`）、区块标题（`.v3-section-title`）、操作条（`.v3-toolbar`）、表格紧凑密度、按钮组、Empty/Skeleton 统一风格、Drawer 响应式。
- **补全 `main.tsx` ConfigProvider component token**：`Drawer`/`Modal`/`Tag`/`Statistic`/`Segmented` 的圆角、头高、字号、padding，与卡片/表格一致。
- 统一 type scale（标题 20/16/13、数字 tabular-nums 18~20），8px 间距体系落地到所有 biz 页。
- 决策依据：既有 `v3-*` 已符合"紧凑、可扫描"目标，复用可避免双套令牌、降低回归风险。

### B. 页面骨架与导航（BizLayout）
- 暗色 Sider（沿用 `v3-sidebar` 色 `#273337`）增加品牌区；激活菜单项加左侧指示条（CSS `.ant-menu-item-selected::before`）；Sider 宽 208→200，Header 高 48 保持。
- 细化响应式断点：1280 / 1024 / 768 / 480；移动端 Drawer 宽度 240→安全值，关闭后焦点回归。
- **保持** `isModulePortal`（portal/maintenance 无侧栏）逻辑与 M7 断言不变。

### C. 经营分析页（核心，保留 CSV 注入中和）
- 指标区改用 `.v3-metric-strip`（8 项，响应式 8→4→2），净利/超额置顶并加语义色。
- 筛选区窄屏换行堆叠（`.v3-toolbar` flex-wrap）。
- 9 列地市表：首列冻结 + `size="small"` 紧凑密度 + `tabular-nums`。
- 导出改为 **loading + `message.success` toast**（不再裸 `a.click()`）。
- **保留** `escapeCsv` 公式注入中和（CWE-1236）；**保留** 全部 `data-testid`（analysis-month-filter / city-filter / clear-filter / export / city-table）。

### D. 合同 / 订单 / 成本 / 线下完工 / 账号管理
- 统一"页头（`.v3-page-head`）+ 操作条（`.v3-toolbar`）+ 表格卡片（`.v3-panel`）"模板。
- 状态 Tag 语义色集中映射（等级 A/B/C/D、完成/驳回/作废、alert 类型）。
- Drawer 内部响应式（桌面 720 / 移动 92% 时内部区块单列）；上传与表单视觉反馈。
- **保留** 全部 `data-testid`：`contract-detail-HT-M12-JINAN`、`contract-start-date` / `contract-end-date`、各页 `biz-*` 等。

### E. 登录页（单栏居中）
- `BizLogin.css` 由双栏 + 全屏背景图改为**单栏居中卡片**：去除全屏 `login-sky-clouds.jpg` 营销感，改用安静的浅色/低饱和渐变背景；表单卡片居中、留白收敛。
- **保留** 登录逻辑、密码 `min:6` 约束、全部 `data-testid`（biz-login-username/password/submit）；`login-sky-clouds.jpg` 资源保留不删（仅不再作为全屏主视觉）。

---

## 3. 文件清单（预计改动）

| 文件 | 动作 | 说明 |
|---|---|---|
| `apps/admin-web/src/App.css` | EXTEND | 新增 biz 工具层（状态色/页头/操作条/表格密度/Empty/Skeleton/Drawer 响应式），复用 v3-* |
| `apps/admin-web/src/main.tsx` | EXTEND | 补全 Drawer/Modal/Tag/Statistic/Segmented 组件 token |
| `apps/admin-web/src/components/biz/BizLayout.tsx` | MODIFY | 侧栏品牌/激活指示条/响应式断点/移动 Drawer 焦点 |
| `apps/admin-web/src/pages/biz/BizAnalysis.tsx` | MODIFY | 指标条/筛选区/首列冻结/导出 loading+toast；保留 CSV 中和 |
| `apps/admin-web/src/pages/biz/BizContracts.tsx` | MODIFY | 统一模板 + 状态语义色 + Drawer 响应式 |
| `apps/admin-web/src/pages/biz/BizOrders.tsx` | MODIFY | 统一模板 + 上传反馈 |
| `apps/admin-web/src/pages/biz/BizCosts.tsx` | MODIFY | 统一模板 |
| `apps/admin-web/src/pages/biz/BizOfflineCompletions.tsx` | MODIFY | 统一模板 |
| `apps/admin-web/src/pages/biz/BizAdmin.tsx` | MODIFY | 统一模板 + 重置密码 Modal 视觉分组；保留 min:6/loading/真实错误 |
| `apps/admin-web/src/pages/biz/BizLogin.tsx` | MODIFY(轻) | 结构微调（壳类名保留） |
| `apps/admin-web/src/pages/biz/BizLogin.css` | MODIFY | 双栏→单栏居中，去全屏背景图 |
| `apps/admin-web/src/pages/biz/BizPortal.tsx` | MODIFY(轻) | 模块卡片信息层级 |
| `apps/admin-web/src/pages/biz/BizMaintenancePortal.tsx` | MODIFY(轻) | 信息层级 |
| `apps/admin-web/src/pages/biz/BizSettings.tsx` | MODIFY(轻) | 复用 v3 设置网格 |
| 测试脚本 `scripts/test/m7-views.mjs`、`run-m12-interaction.mjs` | 默认不改 | 仅当 data-testid 误删时补强；本次预计无需改动 |

---

## 4. 明确不在范围（绝对约束）

- 业务功能 / 口径 / 接口 / 路由 / 权限 / 登录逻辑 / 令牌 / 字段含义 / 状态机 / 后端。
- 数据库 / 迁移 / 环境变量 / 部署配置；不上传、不部署。
- 测试删除或弱化；不改 `data-testid`。
- 用户两张 baseline 截图（`admin-desktop.png` / `admin-mobile.png`）。
- `window.prompt` 相关交互（订单/成本/线下完工的作废、驳回）——保留不改。
- CSV 公式注入中和逻辑——保留已实现，不削弱。
- 不替换 UI 框架；不改动 `apps/api`、`packages/shared-types`。
- 不引入密钥 / 敏感数据。

---

## 5. 验证与验收

- `corepack pnpm --filter @biz-reporting/admin-web typecheck`
- `corepack pnpm --filter @biz-reporting/admin-web build`
- `corepack pnpm test:m7-views`（chromium，1440x900 + 390x844；portal 无侧栏断言、admin 重置密码 Modal 断言）
- `corepack pnpm test:m12-interaction`（chromium + webkit；筛选/CSV 导出/合同日期/无控制台错误）
- 视觉证据（新目录 `docs/visual-audit/screenshots-optimized/`）：登录 / 门户 / 经营分析 / 订单 / 账号管理与重置密码弹窗 的桌面 + 移动端截图。
- 残余风险：M7 会重写 `docs/baseline/screenshots/admin-*.png`，已通过离线备份 + sha256 校验还原策略规避。
