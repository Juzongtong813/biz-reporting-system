# 经营单元上报系统 - 后端 API
# CloudBase Run 部署用
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]

WORKDIR /app

COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-constants/package.json ./packages/shared-constants/
COPY apps/api/package.json ./apps/api/

RUN npm install -g pnpm@9
RUN pnpm config set script-shell /bin/ash

RUN pnpm install --no-frozen-lockfile --prefer-offline

COPY packages/shared-types ./packages/shared-types
COPY packages/shared-constants ./packages/shared-constants
COPY apps/api ./apps/api

RUN pnpm --filter @biz-reporting/shared-types build
RUN pnpm --filter @biz-reporting/shared-constants build
RUN pnpm --filter @biz-reporting/api build

# 用 pnpm deploy 生成独立部署目录（自动处理 symlink，仅含生产依赖）
RUN pnpm deploy --filter=@biz-reporting/api /app/deploy

FROM node:20-alpine AS runner

WORKDIR /app

# 复制 pnpm deploy 生成的独立部署目录
COPY --from=builder /app/deploy ./

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api || exit 1

EXPOSE 3000

CMD ["node", "dist/main.js"]
