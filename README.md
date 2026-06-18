# 经营单元上报系统 (Biz Reporting System)

## 系统概述

城市经营单元数据填报系统，包含三个子系统：

| 子系统 | 技术栈 | 说明 |
|--------|--------|------|
| **API 后端** | NestJS + TypeORM + MySQL | RESTful API，管理后台 + 小程序共用 |
| **Admin 管理后台** | React 18 + Ant Design 5 + Vite 5 | 系统管理员操作界面 |
| **微信小程序** | 原生小程序 | 城市用户数据填报入口 |

## 角色定义

- `system_admin` — 管理员（账号密码登录）
- `city_user` — 城市用户（微信登录，绑定城市）

## Monorepo 结构

```
biz-reporting-system/
├── apps/
│   ├── api/              # NestJS 后端
│   ├── admin-web/        # React 18 管理后台
│   └── miniapp/          # 微信小程序
├── packages/
│   ├── shared-types/     # 共享 TypeScript 类型
│   └── shared-constants/ # 共享常量
├── docs/                 # 参考文档 (v2 交接包)
└── migration/            # 数据库迁移脚本
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动 API 开发服务器
pnpm dev:api

# 启动 Admin 管理后台
pnpm dev:admin
```

## 核心业务模块

1. **Auth** — 登录认证（管理员密码 / 微信 openid）
2. **Annual Package** — 年度报表包（按城市×年度，月度快照）
3. **Contract** — 合同管理（完工 / 审定金额，跨地市分配）
4. **Cost Reporting** — 费用填报（7 大固定类别）
5. **Maintenance Reporting** — 维保填报（按城市配置启用）
6. **Dashboard** — 数据汇总看板
7. **Import / Export** — Excel 导入导出

## 参考文档

v2 交接包源文件位于 `docs/` 目录：
- `biz-reporting-mysql-ddl.sql` — 17 张表 DDL（数据库唯一事实来源）
- `biz-reporting-openapi-initial.yaml` ~37 个 API 端点（接口唯一事实来源）
