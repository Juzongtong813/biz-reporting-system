# =============================================================================
# 经营单元上报系统 - 后端 API Dockerfile
# CloudBase Run 部署使用
#
# 构建命令（在项目根目录 biz-reporting-system/ 执行）：
#   docker build -t biz-reporting-api:latest -f apps/api/Dockerfile .
#
# 运行命令：
#   docker run -p 3000:3000 \
#     -e DB_TYPE=sqlite \
#     -e DB_SYNC=true \
#     -e JWT_SECRET=local-dev-secret \
#     biz-reporting-api:latest
# =============================================================================

FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]

WORKDIR /app

# 复制 pnpm workspace 配置文件
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-constants/package.json ./packages/shared-constants/
COPY apps/api/package.json ./apps/api/

# 安装 pnpm
RUN npm install -g pnpm@9
RUN pnpm config set script-shell /bin/ash

# 安装依赖（仅生产 + 构建用）
RUN pnpm install --no-frozen-lockfile --prefer-offline

# 复制源码
COPY packages/shared-types ./packages/shared-types
COPY packages/shared-constants ./packages/shared-constants
COPY apps/api ./apps/api

# 先构建共享包，再构建 API
RUN pnpm --filter @biz-reporting/shared-types build
RUN pnpm --filter @biz-reporting/shared-constants build
RUN pnpm --filter @biz-reporting/api build

# 用 pnpm deploy 生成独立部署目录（自动处理 symlink，仅含生产依赖）
RUN pnpm deploy --filter=@biz-reporting/api /app/deploy

# =============================================================================
# 运行阶段（用 pnpm deploy 生成独立部署目录，自动处理 symlink）
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# 复制 pnpm deploy 生成的独立部署目录
COPY --from=builder /app/deploy ./

# 健康检查（使用公开的 /api 端点，无需认证）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api || exit 1

EXPOSE 3000

CMD ["node", "dist/main.js"]
