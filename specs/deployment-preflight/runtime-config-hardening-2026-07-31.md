# Production 配置边界加固

日期：2026-07-31

## 修复

production 配置验证现在拒绝以下本机或未指定目标，避免通过字符串变体回退到容器、本机或 loopback 依赖：

- `127.0.0.0/8`，包括 `127.0.0.2`
- `localhost`、`localhost.` 与 `localhost.*`
- IPv6 `::1`、`::` 与 IPv4-mapped loopback
- `0.0.0.0`
- 非规范数据库端口，例如 `3306.0`，以及 0 或超过 65535 的端口
- 指向上述目标的 HTTPS CORS origin

该逻辑不改变开发/测试模式；仅在 `NODE_ENV=production` 生效。

## 验证

`node scripts/test/check-production-runtime-config.mjs` 已通过。它临时编译 API 源码，验证合法 staging 配置和全部上述拒绝路径，完成后清理临时目录。

另已复跑：

- `node scripts/test/run-deployment-preflight.mjs`
- API V3 源码类型检查
- `node scripts/test/check-fact-storage-gate.mjs`

Docker CLI/daemon 在本机不可用，故未执行容器镜像实际构建；这项仍需在隔离 CI 或部署平台的构建环境完成。

## 门禁影响

本项是本地工程防护，资格为 `non_gate`。`GIT_RELEASE_TRACEABILITY`、`REAL_MYSQL`、`BROWSER`、`PERSISTENT_STORAGE` 和 `DEPLOYMENT_GATE` 不变。
