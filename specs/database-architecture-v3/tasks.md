# 数据库架构 V3 执行任务

> 状态：方案已建立，执行尚未授权  
> 对应需求：`requirements.md`  
> 对应设计：`design.md`

## Phase 0：权威基线与授权

- [x] DB-0.1 完成 CloudBase 只读结构审计
  - 已核对实例、18 张表、列、索引、外键、权限和聚合数据质量。
  - 已确认 005-007 未落库、无迁移账本、存在 schema drift。
  - _Requirement: DB-R1_

- [ ] DB-0.2 冻结受审发布 commit
  - 将当前发布必需文件纳入可复现 Git 提交。
  - 记录迁移 checksum、应用版本和构建产物摘要。
  - _Requirement: DB-R1, DB-R10_

- [ ] DB-0.3 获得隔离资源操作授权
  - 明确新 CloudBase 环境或新 schema、预算、所有者和销毁策略。
  - 明确禁止操作 `zy-data` 默认 schema 和现有公网服务。
  - _Requirement: DB-R2, DB-R10_

## Phase 1：迁移前证据与恢复能力

- [ ] DB-1.1 导出现有 schema 基线
  - 保存 DDL、索引、外键、ACL、表行数和结构摘要。
  - 证据不得包含密码哈希、openid 明文或业务明细。
  - _Requirement: DB-R1_

- [ ] DB-1.2 建立数据库和源文件备份
  - 数据库备份与 Base64/历史文件备份分别保存并计算 SHA-256。
  - 记录备份位置、加密、保留期和恢复责任人。
  - _Requirement: DB-R6, DB-R9_

- [ ] DB-1.3 完成隔离恢复演练
  - 恢复数据库与文件并核对结构、数量和哈希。
  - 未通过恢复演练不得开始数据迁移。
  - _Requirement: DB-R9_

## Phase 2：隔离 V3 数据库

- [ ] DB-2.1 创建隔离 MySQL 环境
  - 环境必须显式标记 isolated，使用专用账号和非默认凭据。
  - 配置 VPC、临时迁移访问和最小权限。
  - _Requirement: DB-R2, DB-R8_

- [ ] DB-2.2 从空库执行 001-007
  - 验证 8 行账本、checksum、二次幂等、007 生成列和根账号唯一索引。
  - 验证失败账本和测试 schema 自动清理。
  - _Requirement: DB-R2, DB-R4_

- [ ] DB-2.3 验证 CloudBase ACL
  - 默认业务表设为 `ADMINONLY`，仅明确客户端访问的表评估 `_openid`。
  - 保存表权限证据。
  - _Requirement: DB-R8_

## Phase 3：008+ 中台结构

- [ ] DB-3.1 实现 `008_ingestion_publication_foundation`
  - 建立 source files、root batches、components、records、quality、published versions 和 lineage。
  - 补齐实体、repository、checksum 和 MySQL/SQLite 测试。
  - _Requirement: DB-R3, DB-R6_

- [ ] DB-3.2 实现 `009_master_data_and_metric_versions`
  - 建立合同别名、年度计划、合同月度值、驱动值、综合代维快照和指标定义。
  - 明确业务唯一键、值状态、数据性质、单位、期间和场景。
  - _Requirement: DB-R3, DB-R5_

- [ ] DB-3.3 实现 `010_legacy_migration_tracking`
  - 建立源主键映射、迁移批次、对账结果和兼容视图。
  - 保证迁移可重放、可审计且不重复写入。
  - _Requirement: DB-R5, DB-R7_

## Phase 4：主数据和账号迁移

- [ ] DB-4.1 迁移 cities、contracts 和 allocations
  - 保留 ID，校验合同编码和合同+地市唯一性。
  - 修正字符集但不改变业务文本。
  - _Requirement: DB-R5, DB-R7_

- [ ] DB-4.2 迁移用户身份
  - 显式转换 `cityId` -> `city_id`，保留 openid 和状态。
  - 不复制无用途的 `_openid`，除非新访问模型要求客户端直连。
  - _Requirement: DB-R4, DB-R8_

- [ ] DB-4.3 建立四角色账号基线
  - 由项目负责人指定唯一 `root_admin`。
  - 创建或映射 `contract_manager`、`system_admin`、`city_user`，验证临时密码和邀请绑定。
  - _Requirement: DB-R4_

## Phase 5：历史报表和事实迁移

- [ ] DB-5.1 迁移报表包和合同月度值
  - 将旧包转换为来源批次、发布版本和合同月度值。
  - 保留合同快照、月份、锁定状态和来源定位。
  - _Requirement: DB-R3, DB-R7_

- [ ] DB-5.2 治理 79 条月度孤儿记录
  - 按合同快照、地市和别名生成候选映射。
  - 无法唯一确认的记录进入阻塞质量问题，禁止发布。
  - _Requirement: DB-R5_

- [ ] DB-5.3 迁移旧成本与综合代维数据
  - 明确 actual/forecast 后写入相应事实或计划资产。
  - 空白、零和缺失保持原语义。
  - _Requirement: DB-R3, DB-R7_

- [ ] DB-5.4 迁移操作审计
  - 保留 2 条孤儿日志的 legacy actor 标识。
  - 不创建虚假用户，不丢弃历史日志。
  - _Requirement: DB-R5_

## Phase 6：对象存储迁移

- [ ] DB-6.1 建立隔离 COS 或持久卷
  - 配置 storage key 规则、访问权限、加密和保留策略。
  - _Requirement: DB-R6, DB-R8_

- [ ] DB-6.2 迁移 Base64 历史文件
  - 上传、下载并核对 SHA-256 后写入 storage key。
  - 任一失败不得清理原字段。
  - _Requirement: DB-R6_

- [ ] DB-6.3 完成重启与恢复验证
  - 验证 API 重启、实例重建、文件恢复及数据库+文件联合恢复。
  - _Requirement: DB-R6, DB-R9_

## Phase 7：应用与浏览器验收

- [ ] DB-7.1 部署隔离 CloudRun API
  - 仅连接新 V3 数据库和隔离存储。
  - 使用最小权限账号、`DB_SYNC=false` 和非默认 JWT 密钥。
  - _Requirement: DB-R8_

- [ ] DB-7.2 执行自动化和影子对账
  - 覆盖迁移、事实、认证、导出、权限、幂等和恢复。
  - 新旧结果按地市、年度、合同和指标对账。
  - _Requirement: DB-R7, DB-R9_

- [ ] DB-7.3 执行四角色浏览器闭环
  - 登录、临时改密、旧 JWT、跨地市、筛选和逐页 XLSX 下载全部留证。
  - _Requirement: DB-R4, DB-R8, DB-R9_

## Phase 8：切换和观察期

- [ ] DB-8.1 提交生产切换审批包
  - 包含备份、恢复、对账、性能、权限、浏览器和回滚证据。
  - _Requirement: DB-R9, DB-R10_

- [ ] DB-8.2 执行受控流量切换
  - 切换新前端/API，旧 schema 保持只读。
  - 监控错误率、延迟、对账差异和旧入口调用量。
  - _Requirement: DB-R9_

- [ ] DB-8.3 完成观察期和归档决策
  - 观察期通过后单独批准旧服务、旧 schema 和 Base64 字段归档。
  - 未授权不得删除任何旧资源。
  - _Requirement: DB-R9, DB-R10_

## 最终门禁

- `GIT_RELEASE_TRACEABILITY=PASS`
- `ISOLATED_MYSQL_MIGRATIONS=PASS`
- `DATA_RECONCILIATION=PASS`
- `RBAC_AND_BROWSER=PASS`
- `PERSISTENT_STORAGE_AND_RESTORE=PASS`
- `CUTOVER_ROLLBACK_DRILL=PASS`

全部满足后，`DEPLOYMENT_GATE` 才能从 `BLOCKED` 改为 `PASS`。
