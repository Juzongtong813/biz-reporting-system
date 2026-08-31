# NAS 独立部署手册

本手册针对 fnOS NAS 的独立实例，不迁移 CloudBase 正式数据，也不修改 CloudBase 线上资源。

## 固定边界

- 本地代码是唯一部署来源。
- NAS 使用全新的 `biz_reporting_nas` MySQL 数据库。
- 部署目录为 `/mnt/pool/docker/biz-reporting`。
- 本阶段不部署 Ollama。
- 公网入口使用购买的根域名 + Cloudflare Tunnel。
- CloudBase 继续运行，作为独立旧环境和回滚入口。
- MySQL、NPM 管理端口和 fnOS 管理端口不公开。

## 一次性准备（用户在 fnOS 操作）

1. 在 fnOS 确认 Docker 和 Docker Compose 可用。
2. 确认存储池路径 `/mnt/pool/docker` 存在。
3. 建议为 NAS 保留固定局域网地址 `192.168.1.2`，但不做路由器端口转发。
4. 开启 SSH，后续通过 SSH 执行命令。

## 上传项目文件（用户操作）

将仓库上传到 NAS，例如：

```bash
mkdir -p /mnt/pool/docker/biz-reporting
cd /mnt/pool/docker/biz-reporting
# 使用 Git clone、SFTP 或 fnOS 文件管理器上传项目文件
```

Compose 文件必须位于仓库的 `deploy/nas/compose.yml`，不要把整个仓库直接当作数据卷挂载给运行容器。

## 配置环境变量（用户操作）

```bash
cd /mnt/pool/docker/biz-reporting
cp deploy/nas/.env.example .env
chmod 600 .env
# For the one-time bootstrap command below, load the non-secret variable names
# into the shell; Docker Compose itself reads the file independently.
set -a
source .env
set +a
```

编辑 `.env`：

- `DOMAIN` 填购买的根域名，例如 `example.com`，不带 `https://`。
- 设置独立的 `DB_PASSWORD` 和 `MYSQL_ROOT_PASSWORD`。
- 设置两个不同的随机密钥 `JWT_SECRET`、`AUTH_SECURITY_HMAC_KEY`。
- Cloudflare Tunnel 创建完成后再填写 `CLOUDFLARE_TUNNEL_TOKEN`。

NAS 版的 `super` 密码不写入 `.env`。初始化时由用户通过临时环境变量输入。

## 启动数据库并初始化结构

```bash
cd /mnt/pool/docker/biz-reporting
docker compose --env-file .env -f deploy/nas/compose.yml up -d mysql
docker compose --env-file .env -f deploy/nas/compose.yml ps
docker compose --env-file .env -f deploy/nas/compose.yml --profile init run --rm migrate
```

迁移脚本按 `apps/api/migration` 的完整顺序执行，并写入 `schema_migrations`。不要使用 `DB_SYNC=true`。

## 初始化 super 账号

在 NAS 上执行，密码不会出现在命令历史中：

```bash
read -r -s BIZ_SUPER_ADMIN_PASSWORD
export BIZ_SUPER_ADMIN_PASSWORD
export BIZ_SUPER_ADMIN_USERNAME=super
export BIZ_BOOTSTRAP_DB_TYPE=mysql
export BIZ_BOOTSTRAP_DB_DATABASE="$DB_DATABASE"
export DB_HOST=mysql
export DB_PORT=3306
export DB_USERNAME="$DB_USERNAME"
export DB_PASSWORD="$DB_PASSWORD"
docker compose --env-file .env -f deploy/nas/compose.yml run --rm \
  -e BIZ_SUPER_ADMIN_USERNAME \
  -e BIZ_SUPER_ADMIN_PASSWORD \
  -e BIZ_BOOTSTRAP_DB_TYPE \
  -e BIZ_BOOTSTRAP_DB_DATABASE \
  -e DB_HOST -e DB_PORT -e DB_USERNAME -e DB_PASSWORD \
  migrate sh -c 'node scripts/auth/biz-init-super-admin.mjs'
unset BIZ_SUPER_ADMIN_PASSWORD
```

## 启动业务容器

```bash
docker compose --env-file .env -f deploy/nas/compose.yml up -d api frontend npm
docker compose --env-file .env -f deploy/nas/compose.yml ps
docker compose --env-file .env -f deploy/nas/compose.yml logs --tail=100 api
```

内网第一阶段检查：

- `http://192.168.1.2:18080` 应能打开前端。
- `http://192.168.1.2:18181` 仅在内网打开 NPM 管理后台。
- 不要把 `3306`、`18181` 或 `11434` 配置到公网。

在 NPM 管理后台创建一个 Proxy Host：

```text
Domain Names: 购买的根域名
Forward Hostname/IP: frontend
Forward Port: 80
```

开启 Websockets Support。前端容器内部已经将 `/api` 反向代理到 `api:3000`，所以不需要另建公网 API 域名。

## Cloudflare Tunnel（用户操作）

1. 将域名添加到 Cloudflare，并在域名注册商处修改 Nameserver。
2. 保留邮箱相关 MX、SPF、DKIM、DMARC 记录。
3. 在 Cloudflare Zero Trust > Networks > Tunnels 创建命名 Tunnel。
4. 创建 Published application：

```text
Hostname: 购买的根域名
Service: http://npm:80
```

5. 复制 Docker Tunnel Token，写入 NAS `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
6. 启动 Tunnel：

```bash
docker compose --env-file .env -f deploy/nas/compose.yml --profile tunnel up -d cloudflared
docker compose --env-file .env -f deploy/nas/compose.yml logs --tail=100 cloudflared
```

Cloudflare 官方文档说明 Tunnel 使用出站连接，不要求 NAS 有公网 IPv4 或开放入站端口：
<https://developers.cloudflare.com/tunnel/setup/>

## 验收

- `https://购买的根域名` 能打开登录页。
- 登录后 API 请求地址为同源 `/api`，不再请求 CloudBase API。
- 新数据库中可以完成合同、订单、成本、经营分析、权限和审计日志操作。
- `super`、管理员、地市账号权限符合本地最新版。
- 年度 + 月度筛选正常。
- NAS 重启后 `mysql`、`api`、`frontend`、`npm` 自动恢复。
- CloudBase 页面和数据不受影响。

## 备份与回滚

手动备份：

```bash
NAS_PROJECT_ROOT=/mnt/pool/docker/biz-reporting bash deploy/nas/backup.sh
```

备份整个项目目录前，先停止或暂停写入业务；MySQL 备份文件应复制到另一块磁盘或异地存储。

NAS 异常时，停止 Tunnel 或移除 Cloudflare Published application，继续使用 CloudBase 入口即可。两套环境不共享数据库，因此不会相互污染。
