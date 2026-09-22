FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /workspace

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-constants/package.json packages/shared-constants/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json

RUN npm install -g pnpm@9.15.0 \
  && pnpm install --frozen-lockfile --prefer-offline

COPY packages/shared-types packages/shared-types
COPY packages/shared-constants packages/shared-constants
COPY apps/admin-web apps/admin-web

# The NAS app is served behind the same-origin Nginx /api route.
ENV VITE_API_BASE_URL=/api
ENV VITE_ENABLE_MSW=false
RUN pnpm --filter @biz-reporting/shared-types build \
  && pnpm --filter @biz-reporting/shared-constants build \
  && pnpm --filter @biz-reporting/admin-web build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /workspace/apps/admin-web/dist /usr/share/nginx/html
COPY deploy/nas/frontend-nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

EXPOSE 80
