# 原始合同台账上传记录设计

## 模块边界

继续复用 `BizContractsModule`、`POST /biz/contracts/upload` 和合同管理页面。新增上传记录、工作表和原始行实体；合同主表只增加必要标准字段与来源血缘，不保存整行冗余副本。

## 数据模型

### biz_contract_import_records

一次上传一个不可变记录：`id`、文件名、SHA-256、状态、工作表数、总/有效/待维护行数、上传人、数据范围快照、完成时间和失败原因。文件二进制不入库。

### biz_contract_import_sheets

保存上传记录内的工作表顺序、名称、使用区域起止坐标、行列数、表头 JSON、表头行号及是否为合同数据表。

### biz_contract_source_rows

保存每个使用区域行（含表头和辅助表）的原始行号、定长单元格 JSON、行类型、标准化状态、问题说明以及关联的省份、经营单位和合同。数组长度固定为工作表列数，空单元格显式为 `null`。

单元格采用 JSON 联合类型：字符串、数字、布尔、`null`、日期对象 `{kind:"date",value:"..."}`、公式对象 `{kind:"formula",formula:"...",value:...}`。这样无需保存样式也能重建数据类型与公式内容。

### biz_contracts 增量字段

- `archive_contract_no`：档案室合同编号。
- `project_identity_code`、`contract_category_1/2`、`winning_project_name`。
- `signed_date`、`tax_rate_raw`、`tax_rate_bp`、`tax_rate_bps_json`。
- `source_import_record_id`、`source_sheet_id`、`source_row_id`、`source_row_no`。

## 解析流程

1. 读取工作簿并执行现有资源限制。
2. 在单个数据库事务内创建上传记录、工作表和全部原始行。
3. 通过归一化表头精确识别合同数据表；辅助表仅存档。
4. 对数据表逐行提取字段并分为阻断错误和非阻断提示。
5. 对合同号做占位值、文件内重复和数据库冲突校验。
6. 预扫描省份/地市提示，对受控省级名称自动补齐缺失省份；对明确城市词补齐经营单位。
7. 对省份和经营单位做标准名/受控别名精确匹配；一行多个城市建立多个零额度关系。
8. 对有效行创建待生效合同；不创建管理费率，额度由管理员单独填写。
9. 回写来源行状态、合同血缘和上传记录计数，写入主数据自动配置审计日志后提交。

任一步骤抛出系统错误时整个事务回滚，随后记录失败上传记录；业务行错误不会回滚其他行。

## 金额、税率和日期

- 万元转分使用十进制定点字符串解析，结果等价于 `万元 × 1,000,000` 的四舍五入整数，避免二进制浮点边界误差。
- 税率接受数值、百分号和 `/` 分隔复合值，全部转为整数基点数组；单值同步写 `tax_rate_bp`。
- 日期接受 `Date`、Excel 序列号、`YYYY-M-D`、`YYYY.M.D`、`YYYY/M/D`；期限文本提取前两个完整日期。

## API

- `POST /biz/contracts/upload`：上传原始台账，返回上传记录摘要和问题摘要。
- `GET /biz/contracts/import-records`：上传记录列表。
- `GET /biz/contracts/import-records/:id`：上传详情、工作表与问题行。
- `GET /biz/contracts/import-records/:id/source-workbook`：从数据库重建 XLSX。

原始台账下载复用 `operation.contract.batch_read`，并要求 `all` 或 `contract` 数据范围；混合省份上传记录不向省/经营单位范围账号下发整本文件。

## 前端

合同管理页保留现有高密度 Ant Design 工作台结构：移除“下载模板”，上传弹窗直接说明接受原始台账；同页增加“上传记录”表格/抽屉，展示解析统计、问题和原始台账下载。订单页把“批次”统一改为“上传记录”，增加待维护下载与修正上传操作。

## 测试

- 使用真实表头和合成小工作簿验证三工作表、空表头列、空单元格、万元转分、复合税率、Excel/文本日期、辅助表和重建内容。
- 验证重复合同、现有合同、复杂地市、`province_branch`、权限拒绝和审计日志。
- 订单修正验证事务回滚、并发接替唯一性、范围裁剪和原始 JSON 脱敏。
