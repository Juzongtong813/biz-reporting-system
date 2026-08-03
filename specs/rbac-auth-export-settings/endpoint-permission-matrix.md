# API 端点权限矩阵

## 全局规则

- Guard 顺序：`JwtAuthGuard -> PermissionsGuard -> RolesGuard`。
- 仅显式 `@Public()` 端点匿名可访问；`root_admin` 权限全量，但根账号保护仍由服务和数据库执行。
- 显式 `@Permissions` 端点以权限代码为准；旧 `@Roles` 端点由全局 `RolesGuard` 兼容保护。
- `city_user` 的 `cityId` 每次从数据库认证记录取得，请求参数不能扩展范围。
- `must_change_password=true` 时仅允许 `me.read`、`me.password.update`、`auth.logout`。

## Public

| 端点 | 允许范围 |
|---|---|
| `GET /api` | 健康检查 |
| `POST /api/auth/admin/login` | `root_admin`、`contract_manager`、`system_admin` |
| `POST /api/auth/city/login` | `city_user` |
| `POST /api/auth/wechat/login` | 已启用、已绑定的 `city_user` |
| `POST /api/auth/wechat/bind` | 有效的一次性邀请 + 微信 code |

`POST /api/auth/city/register` 和 `POST /api/auth/wechat/register` 不存在，必须返回 404。

## 本人与账号管理

| 端点 | 权限/角色 |
|---|---|
| `GET /api/me` | 四角色，`me.read` |
| `PATCH /api/me/password` | 四角色，`me.password.update`，仅本人 |
| `POST /api/auth/logout` | 四角色，`auth.logout` |
| `/api/admin/users/**` | 仅 `root_admin`；创建、启停、角色、地市、重置、邀请分别使用账号权限代码 |

## 合同

| 能力 | root_admin | contract_manager | system_admin | city_user |
|---|---:|---:|---:|---:|
| 合同读取 | 是 | 是 | 是 | 仅本地已分配 |
| 合同创建/编辑/软删 | 是 | 是 | 否 | 否 |
| 合同分配维护 | 是 | 是 | 否 | 否 |
| 物理清理 | 是 | 否 | 否 | 否 |

## 省级旧端点兼容保护

| 端点组 | root_admin | system_admin | contract_manager | city_user |
|---|---:|---:|---:|---:|
| `/api/admin/packages/**` | 是 | 是 | 否 | 否 |
| `/api/admin/imports/**`、`/api/admin/import-jobs/**` | 是 | 是 | 否 | 否 |
| `/api/admin/reminders/**`、`/api/admin/ai/**` | 是 | 是 | 否 | 否 |
| `/api/admin/cities/**`、`/api/admin/city-configs/**` | 是 | 是 | 否 | 否 |
| `/api/admin/recalc-tasks/**` | 是 | 是 | 否 | 否 |

自动化明确覆盖：`city_user` 与 `contract_manager` 访问 packages/imports/reminders/AI 返回 403；`system_admin` 调用仅地市可写端点返回 403；`root_admin` 对 packages/import-jobs 保持兼容访问。

## 新权限端点

| 端点组 | 权限 | 范围 |
|---|---|---|
| `/api/admin/dashboard/**` | `dashboard.read` | `root_admin`、`system_admin` |
| `/api/admin/facts/**` | `province.facts.read` | `root_admin`、`system_admin` |
| `/api/admin/operation-logs` | `operation_logs.read` | `root_admin`、`system_admin` |
| `/api/city/facts/**` 读取 | `city.data.read` | 仅 `city_user` 数据库绑定地市 |
| `/api/city/facts/**` 写入 | `city.data.write` / `city.import` | 仅 `city_user` 数据库绑定地市及已分配合同 |
| `POST /api/exports/audit` | `export.audit` | 服务端以认证身份覆盖客户端范围标签 |

## 未关闭项

- Admin Facts API 目前支持全省或单 `cityId`，尚未提供多 `cityIds` 查询契约。
- 旧报表包端点处于过渡兼容期，退出条件见 `requirements.md` R7。
