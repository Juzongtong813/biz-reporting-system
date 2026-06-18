# 云托管部署指南

## 架构概览

```
┌─────────────────────────────────────────────┐
│             微信小程序 (Miniapp)              │
│  HTTPS 请求 → https://api.xxx.com/api/*      │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│      CloudBase Run (云托管)                  │
│  Docker → NestJS API :80 → /api/*           │
│  ├── Auth (JWT)                             │
│  ├── Cities / Contracts / Packages          │
│  ├── Dashboard / Configs / OperationLogs    │
│  └── MySQL 远程连接                          │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│         MySQL 云数据库 (CDB)                  │
│         17 张表 + 初始化 DDL                 │
└─────────────────────────────────────────────┘
```

## 部署方案

### 方案 A：CloudBase Run（推荐）
CloudBase 云托管，Docker 镜像部署，自带 HTTPS、自动扩缩容。

### 方案 B：传统主机部署
使用提供的 Dockerfile 在任何 Docker 环境中运行。

---

## 部署步骤（CloudBase Run）

### 1. 创建 MySQL 云数据库

```sql
-- 在 CloudBase MySQL 中执行：
source apps/api/migration/001_initial_tables.sql
```

### 2. 配置环境变量

在 CloudBase 控制台设置以下环境变量：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 监听端口 | `80`（CloudBase 默认） |
| `DB_TYPE` | 数据库类型 | `mysql` |
| `DB_HOST` | MySQL 内网地址 | `10.x.x.x` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USERNAME` | 数据库用户 | `root` |
| `DB_PASSWORD` | 数据库密码 | `********` |
| `DB_DATABASE` | 数据库名 | `biz_reporting` |
| `DB_SYNC` | 同步模式 | `false`（禁止自动建表） |
| `JWT_SECRET` | JWT 签名密钥 | 随机字符串 |
| `JWT_EXPIRES_IN` | Token 有效期 | `8h` |
| `CORS_ORIGINS` | 跨域来源 | `https://admin.your-domain.com` |
| `WECHAT_APPID` | 小程序 appid | `wx...` |
| `WECHAT_SECRET` | 小程序 secret | `...` |

### 3. 本地验证 Docker 镜像

```bash
# 在项目根目录执行（注意：. 是构建上下文，Dockerfile 引用 workspace 根目录的 pnpm-lock.yaml）
cd biz-reporting-system

# 构建镜像
docker build -t biz-reporting-api:latest -f apps/api/Dockerfile .

# 运行容器（使用 SQLite 快速验证）
docker run -d --name biz-reporting-test \
  -p 3000:3000 \
  -e DB_TYPE=sqlite \
  -e DB_SYNC=true \
  -e JWT_SECRET=test-secret \
  biz-reporting-api:latest

# 验证健康检查
sleep 3 && curl http://localhost:3000/api

# 验证登录
curl -X POST http://localhost:3000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}'

# 清理测试容器
docker stop biz-reporting-test && docker rm biz-reporting-test
```

### 4. 部署到 CloudBase Run

```bash
# 切换到项目根目录
cd biz-reporting-system

# 构建并推送镜像（CloudBase CLI）
cloudbase service create
```

### 4. 获取 HTTPS 域名

CloudBase Run 会自动分配一个 `*.app.tcloudbase.com` 域名，在控制台可查看。

---

## 小程序端配置

### 配置文件路径
`apps/mini-program/utils/`

目录中有两个文件：
- `config.default.js` — 默认开发配置（含 `__PROD_API_HOST_NOT_CONFIGURED__` 占位符）
- `constants.js` — 运行时自动检测环境，读取 `config.prod.js` 中的生产域名

### 配置步骤
```bash
# 1. 复制默认配置为生产配置
cp apps/mini-program/utils/config.default.js apps/mini-program/utils/config.prod.js

# 2. 编辑 config.prod.js，替换为云托管域名
#    PROD_API_HOST: 'https://your-app-xxx.shanghai.app.tcloudbase.com'
```

> ⚠️ 安全机制：`config.prod.js` 已加入 `.gitignore`，不会提交到仓库。
> 若 release 环境下 `config.prod.js` 未配置或仍为占位符，小程序会抛错阻止启动，
> 避免上线后因占位符遗漏导致请求 404。

### 小程序后台白名单
在小程序管理后台 → 开发 → 开发设置 → 服务器域名 中：

| 域名类型 | 值 |
|----------|-----|
| request 合法域名 | `https://your-app-xxx.shanghai.app.tcloudbase.com` |

---

## Admin Web 端配置

### 配置文件路径
`apps/admin-web/.env.production`

```env
VITE_ENABLE_MSW=false
VITE_API_PROXY=https://your-app-xxx.shanghai.app.tcloudbase.com
```

---

## 部署验收清单

- [ ] `GET /api` — 服务可访问
- [ ] `POST /api/auth/admin/login` — admin 登录
- [ ] `POST /api/auth/wechat/login` — 微信登录
- [ ] `POST /api/auth/wechat/register` — 微信注册
- [ ] `GET /api/me` — 当前用户
- [ ] `GET /api/cities` — 城市列表
- [ ] `GET /api/city/packages/current` — 当前年度包
- [ ] `GET /api/city/configs` — 城市配置
- [ ] `POST /api/city/packages/:id/draft-save` — 草稿保存
- [ ] `POST /api/city/packages/:id/submit-preview` — 提交预览
- [ ] `POST /api/city/packages/:id/submit` — 正式提交
- [ ] `GET /api/admin/dashboard` — 仪表盘
- [ ] `GET /api/admin/operation-logs` — 操作日志
- [ ] 云托管日志无异常

---

## 注意事项

1. **DB_SYNC=false** — 生产环境绝对不能为 `true`，使用 DDL 文件手动建表
2. **HTTPS** — 小程序强制要求 HTTPS，云托管自动提供
3. **JWT_SECRET** — 生产环境使用强随机字符串，不要使用默认值
4. **微信登录** — 需要配置 `WECHAT_APPID` 和 `WECHAT_SECRET`，当前使用 mock 模式
5. **CORS** — `CORS_ORIGINS` 是逗号分隔的域名列表，无需加引号
6. **端口** — CloudBase Run 会自动将请求转发到容器端口 80
7. **健康检查** — Dockerfile 内置了 `/me` 端点的健康检查
