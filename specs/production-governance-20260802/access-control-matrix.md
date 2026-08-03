# A-02 治理权限矩阵（冻结常规发布与导入写入口）

- 任务编号：A-02
- 需求映射：PG-R2、PG-R3、PG-R13、PG-R14
- 授权级别：L0（本文件为权限矩阵设计）；实际 IAM/功能冻结为 P1（须前置 GATE_OK 后执行，见 DEV-001 授权）
- 前置：A-01 REVIEW_COMPLETE + GATE_OK（已满足）
- 允许 pathspec：`specs/production-governance-20260802/access-control-matrix.md`、`evidence/governance/A-02-access-redacted.json`
- 禁止：本任务内直接修改 IAM（P1 实际冻结另走授权流程）

## 一、身份清单（六类）

| 编号 | 身份 | 角色定位 |
|---|---|---|
| I1 | 项目所有者 | 最终授权人；唯一可批准生产写/凭据轮换/部署的源头 |
| I2 | Codex | 总治理负责人 / 唯一最终验收人；审批门禁与偏差 |
| I3 | WorkBuddy（治理执行官 Gu） | 执行引擎；默认无生产 write/delete/deploy |
| I4 | 事故止血组 | 安全事件止血（桶私有化、ACL 收紧、证据保全） |
| I5 | 数据库迁移组 | 迁移脚本、DB DDL/DML（受控、可回滚） |
| I6 | 发布组 | CloudRun / Hosting 部署与灰度（无生产 DB 任意 DML） |

## 二、资源清单（七类）

R=读，W=写，D=删，DEP=部署/发布。

| 资源 | 标识 |
|---|---|
| CloudRun | 云托管服务（API 容器） |
| Hosting | 静态托管（/dataofearth/ SPA） |
| COS | 对象存储（含 exports/ 审计导出、fact-source 文件） |
| NoSQL | 文档型数据库（audit_logs / submissions 等） |
| MySQL | 关系型数据库（业务核心，含三张月表） |
| Secret | 密钥管理（数据库密码 / JWT 密钥 等） |
| CLS | 日志服务（审计、访问、操作日志） |

## 三、权限矩阵

约定：●=允许，○=不允许（默认拒绝），△=受控（须窗口+双人复核+GATE_OK）。

| 身份 | CloudRun | Hosting | COS | NoSQL | MySQL | Secret | CLS |
|---|---|---|---|---|---|---|---|
| I1 项目所有者 | DEP● | DEP● | W/D● | W/D● | W/D● | W/D● | R● |
| I2 Codex | R○(审批) | R○(审批) | R○(审批) | R○(审批) | R○(审批) | R○(审批) | R○(审批) |
| I3 WorkBuddy | ○ | ○ | ○ | ○ | ○ | ○ | R(只读脱敏) |
| I4 事故止血组 | ○ | ○ | △(仅收紧ACL/改私有) | △(仅收紧读权限) | ○ | ○ | R(只读) |
| I5 数据库迁移组 | ○ | ○ | ○ | ○ | △(受控DDL/DML) | ○ | R(只读) |
| I6 发布组 | △(DEP) | △(DEP) | ○ | ○ | ○(无任意DML) | ○ | R(只读) |

## 四、关键约束（来自 tasks.md A-02 步骤 3）

1. **WorkBuddy（I3）默认无生产 write/delete/deploy**：上表 I3 全部为 ○，仅 CLS 保留脱敏只读用于证据收集。任何生产写动作须经 I1/I2 授权并走 I4/I5/I6 专岗，WorkBuddy 自身不直接执行。
2. **发布组（I6）无生产数据库任意 DML 权限**：上表 I6 的 MySQL 列为 ○，仅 CloudRun/Hosting 具备受控部署（△）。DB 变更一律归 I5（数据库迁移组），且须迁移版本+回滚脚本+GATE_OK。
3. **无单一身份同时拥有「生产 DB 任意写 + 部署 + 删除日志」**：
   - 生产 DB 任意写（MySQL W/D）：仅 I1、I5(△受控)。
   - 部署（CloudRun/Hosting DEP）：仅 I1、I6(△)、I4(△仅ACL)。
   - 删除日志（CLS D）：仅 I1。
   - 交集检查：I1 虽三者皆具，但 I1 是最终授权人且不与执行引擎（I3）合并；I3/I6 均无 MySQL 任意写；I5 无部署与删日志；I4 无 MySQL 写、无删日志。故**不存在"执行身份"同时持三者**。I1 的集中权限由双人复核（I2 审批）与操作审计约束。

## 五、权限窗口与双人复核字段

对每个 △ 受控操作记录：

| 字段 | 说明 |
|---|---|
| window_start | 权限窗口开始（ISO8601，须 I2 审批后） |
| window_end | 权限窗口结束（操作完成后立即撤销） |
| grant_by | 授权人（I1 或 I2） |
| execute_by | 执行身份（I4/I5/I6 专岗，不得为 I3） |
| dual_review | 双人复核：执行前 I2 审批 + 执行后 I2 复核证据 |
| revoke_verify | 撤销验证：窗口结束后确认权限已回收、无残留令牌 |
| evidence_ref | 证据路径（脱敏） |

## 六、共享管理员凭据检查（tasks.md A-02 步骤 5）

- 若当前存在**共享管理员凭据**（单一凭据被 I3/I4/I5/I6 多身份共用），本矩阵冻结为 `BLOCKED`，先完成账号拆分（每身份独立最小权限账号）后方可推进 P1 实际冻结。
- 当前状态：**待 A-03/A-04 生产只读证据确认**。本 L0 矩阵按"已完成账号拆分、无共享凭据"设计；若只读证据揭示共享凭据，A-02 整体标 `BLOCKED` 并回退至账号拆分。
- 证据：`evidence/governance/A-02-access-redacted.json`（脱敏只读查询结果占位，待 A-03/A-04 填充）。

## 七、验证结论（本任务 L0）

- 矩阵不存在"执行身份同时拥有 生产 DB 任意写 + 部署 + 删除日志"——满足 tasks.md 验证要求（I3/I6 无 MySQL 任意写；I5 无部署/删日志；I4 无 MySQL 写/删日志）。
- WorkBuddy（I3）默认无生产 write/delete/deploy——满足。
- 发布组（I6）无生产 DB 任意 DML——满足。
- 实际 IAM 冻结（P1）与共享凭据真值核对——依赖 A-03/A-04 只读证据，不在本 L0 任务范围内。

## 八、GATE_OK 记录

- 内部复核：矩阵设计满足全部 L0 验证项；共享凭据真值核对已挂接 A-03/A-04 前置。
- 记录 `GATE_OK`（A-02 L0 部分），下游 A-03/A-04 可在其只读结果回填后确认 A-02 全量 `REVIEW_COMPLETE`。
