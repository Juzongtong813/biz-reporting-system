# CloudBase 部署确认报告（快照化重构 / 需求七）

- 报告时间：2026-08-31 10:2x（北京时间）
- 环境 ID：`zy-data-d2g9g1ghr47ac6254`
- 结论：**API 后端与 admin-web 前端均已部署到 CloudBase 并全量生效，生产库快照表已建成，部署后零 ERROR。**

---

## 一、部署总览

| 组件 | 结果 | 版本 / 时间 |
|---|---|---|
| API 后端（CloudRun 容器型） | 已部署，流量 100% | DeployId **039**，2026-08-31 **09:07:01** |
| API 服务上线 | 成功 | 09:10:39 `check_eks_virtual_service : succ` |
| 生产库快照表（8 张） | 已建成 | 09:11:40 启动日志确认 |
| admin-web 前端（静态托管） | 已部署，SUCCESS | 版本 **biz-reporting-prod-029**，09:42:18 |
| 生产运行健康 | 零 ERROR | 09:10–10:35 CLS 检索 ERROR = 0 条 |

---

## 二、API 后端部署证据

### 2.1 部署记录（queryCloudRun getDeployRecords）

```
DeployId    : 039
DeployTime  : 2026-08-31 09:07:01
Status      : normal
RunId       : multi_tenant_1x0qUGxuc2g45I
BuildId     : 2602100117
FlowRatio   : 100          <- 全量流量
HasTraffic  : true
IsReleasing : false
ImageUrl    : ccr.ccs.tencentyun.com/tcb-100042718991-bfdg/
              ca-ssxlthbm_biz-reporting-api-prod:biz-reporting-api-prod-039-20260831090705
```

上一版本 038（08-30 16:47）已 `FlowRatio: 0` + `ScaleStatus: zero`，流量已完全切至 039。

### 2.2 构建与上线流程日志（getProcessLog）

```
-----------构建biz-reporting-api-prod-039-----------
2026-08-31 09:07:05 create_build_image : creating
2026-08-31 09:10:38 check_build_image : succ
-----------服务biz-reporting-api-prod部署biz-reporting-api-prod-039-----------
2026-08-31 09:10:38 create_eks_virtual_service : creating
2026-08-31 09:10:39 check_eks_virtual_service : succ
```

### 2.3 代码时间线吻合性

| 环节 | 时间 |
|---|---|
| `biz-snapshot.service.ts` 最后修改 | 08-31 **08:53** |
| `dist/biz-snapshots/biz-snapshot.service.js` 构建产物 | 08-31 **08:54** |
| CloudRun 039 部署触发 | 08-31 **09:07:01** |

构建产物早于部署触发，确认 039 镜像包含最新源码改动。

### 2.4 在线版本与服务状态（queryCloudRun detail）

```
ServerName        : biz-reporting-api-prod
Status            : normal
UpdateTime        : 2026-08-31 09:07:01
ServerType        : container
OnlineVersionInfos: biz-reporting-api-prod-039  FlowRatio=100
DefaultDomainName : https://biz-reporting-api-prod-265611-4-1362656322.sh.run.tcloudbase.com
AccessTypes       : OA / PUBLIC / MINIAPP
Cpu/Mem           : 0.5 核 / 1 GB，MinNum=1 MaxNum=1
```

---

## 三、生产数据库快照表证据

### 3.1 建表机制（非迁移脚本，而是启动时幂等 DDL）

`apps/api/src/biz-snapshots/snapshot-schema.ts` 定义 `SNAPSHOT_DDL`（8 条 `CREATE TABLE IF NOT EXISTS`）；
`BizSnapshotService.onModuleInit()` 在应用启动时逐条执行，并调用 `ensureContractCompletionColumn()` 幂等补列。

```ts
// biz-snapshot.service.ts:116
async onModuleInit(): Promise<void> {
  try {
    for (const sql of SNAPSHOT_DDL) {
      await this.dataSource.query(sql);
    }
    await this.ensureContractCompletionColumn();
    this.logger.log('[BizSnapshot] 快照表结构已就绪（CREATE TABLE IF NOT EXISTS）');
  } catch (err) {
    this.logger.error(`[BizSnapshot] 快照表结构初始化失败: ...`);
  }
}
```

因此 `apps/api/migration/` 下没有快照表迁移脚本属于**设计如此**，不是遗漏。
注意该实现「失败仅记录不阻断启动」，故必须以启动日志作为建表成功的判据。

### 3.2 生产启动日志（CLS，service=tcbr，容器 biz-reporting-api-prod-039）

```
2026-08-31 09:11:40  [BizSnapshotScheduler]  [BizSnapshot] 自动更新未启用或时间无效，未注册定时任务
2026-08-31 09:11:41  [BizSnapshotService]    [BizSnapshot] 快照表结构已就绪（CREATE TABLE IF NOT EXISTS）
```

- 日志级别为 **LOG**（非 ERROR），确认 8 张快照表在生产库建成，含本次新增的
  `biz_snapshot_contract_ledger`、`biz_snapshot_overrun_periods`。
- 容器标识：`pod_name=biz-reporting-api-prod-039-85b46cc8bc-mjms2`，`pod_ip=10.31.24.182`。
- 定时快照未启用属既有配置项，非本次部署缺陷。

### 3.3 生产库定位（重要澄清）

生产 API 实际连接的是 **CynosDB**，而非 CloudBase 内置 MySQL：

```
DB_HOST     : sh-cynosdbmysql-grp-p18a65zm.sql.tencentcdb.com
DB_PORT     : 24840
DB_DATABASE : biz_reporting_prod
DB_USERNAME : biz_prod_runtime
DB_SYNC     : false          <- TypeORM 不自动同步，故需 onModuleInit 显式建表
```

排查过程中曾误查 CloudBase 内置 MySQL（schema = `zy-data-d2g9g1ghr47ac6254`），
该库仅含 8 月 8 日创建的旧架构表（`contracts` / `submissions` / `users` / `report_*`），
**无任何 `biz_` 前缀表，属废弃库**，不能作为生产数据判据。

---

## 四、前端 admin-web 部署证据

### 4.1 应用部署状态（queryApps listApps）

```
ServiceName       : biz-reporting-prod
Domain            : biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com
DeployType        : static-hosting
Framework         : static
LatestVersionName : biz-reporting-prod-029
LatestBuildTime   : 2026-08-31 09:42:18
LatestStatus      : SUCCESS
```

版本号 029 即 `evidence/prod-login-029.png`（09:50 生产登录截图）中 029 的来源。

### 4.2 线上与本地构建产物字节级一致

| 项 | 本地 `apps/admin-web/dist` | 线上 |
|---|---|---|
| `index.html` 大小 | 485 bytes（mtime 08-30 22:28:36） | 485 bytes |
| JS 指纹 | `assets/index-CeiVRRpP.js` | `assets/index-CeiVRRpP.js` |
| JS 大小 | 1101286 bytes | **1101286 bytes** |

指纹与字节数完全一致，确认线上前端即本地构建版本。

### 4.3 站点可达性

```
GET https://biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com/
-> HTTP 200, 485B, <title>中屹技术有限公司</title>

GET .../assets/index-CeiVRRpP.js
-> HTTP 200, 1101286B
```

静态托管配置：`IndexDocument=index.html`，404 → `index.html`（SPA 路由已生效），
CDN 域名 `zy-data-d2g9g1ghr47ac6254-1362656322.tcloudbaseapp.com`。

---

## 五、生产 API 接口探测（未鉴权只读）

| 接口 | 结果 | 判定 |
|---|---|---|
| `GET /api/health/live` | 200 `{"status":"live"}` | 服务存活 |
| `GET /api/health/ready` | 200 `{"database":"up","storage":"up"}` | 依赖就绪 |
| `GET /api/biz/analysis/contracts` | **401** | 新路由已部署，鉴权生效 |
| `GET /api/biz/analysis/years` | **401** | 同上 |
| `GET /api/biz/analysis/trend?year=2025` | **401** | 同上 |
| `GET /api/biz/analysis/snapshot/status` | **401** | 同上 |
| `GET /api/biz/analysis/snapshot/metadata` | **401** | 同上 |

401（而非 404）证明路由存在且鉴权守卫生效。

---

## 六、部署后运行健康

CLS 检索（service=tcbr，queryString=`ERROR`，2026-08-31 09:10:00 – 10:35:00）：

```
Results: null      -> 0 条 ERROR 日志
```

覆盖区间含 09:42 前端部署与 09:50 生产登录验证，期间无任何服务端错误。

---

## 七、遗留与建议

1. **未提交的源码改动**：`apps/api/src/biz-snapshots/` 整个模块在 git 中为未跟踪（`??`）状态，
   `cloudbaserc.json` 为已修改（`M`）。线上镜像已包含这些改动，但**代码尚未入库**，
   存在「线上有、仓库无」的漂移风险，建议尽快提交。
2. **定时快照未启用**：`[BizSnapshot] 自动更新未启用或时间无效，未注册定时任务`。
   若需要每日自动刷新快照，需补相应配置；当前仅支持手动触发 `POST /api/biz/analysis/snapshot/build`。
3. **生产快照尚未构建**：表结构已就绪，但生产库是否已生成快照数据需登录后调用
   `GET /api/biz/analysis/snapshot/status` 确认；若为空，需手动触发一次 build。

---

## 八、本次操作合规声明

- 全程**未触发任何新的部署动作**，仅做只读查询（部署记录、服务详情、CLS 日志、静态托管配置、HTTP 探测）。
- 未修改生产数据库任何数据，未执行任何写 SQL。
- 未提交 git。
- 生产接口探测均为未鉴权 401 只读探测。
