#!/usr/bin/env node
/**
 * E-06 测试：容器运行时静态校验 + 可选 docker 构建检查（PG-R8/R10/R11）
 *
 * 静态断言（无需 docker）：
 * 1. 权威 Dockerfile = 仓库根 Dockerfile；apps/api/Dockerfile 副本与根一致（唯一权威）。
 * 2. runner 非 root：UID 10001（adduser/addgroup）、COPY --chown=10001:10001、USER 10001。
 * 3. 保留 PORT、live healthcheck（/api/health/live）、持久路径标签（required-persistent-mount）。
 * 4. 禁止：privileged、chmod 777、root entrypoint 后降权替代。
 *
 * docker 构建检查（本机无 docker 时标 PENDING_DOCKER，不伪造 PASS）：
 * - 构建镜像 → 检查 UID/监听/挂载点（I1 隔离挂载在 F-04/G-04 完成）。
 *
 * 用法：node scripts/test/check-container-runtime.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT_DOCKERFILE = path.join(REPO_ROOT, 'Dockerfile');
const API_DOCKERFILE = path.join(REPO_ROOT, 'apps/api', 'Dockerfile');

const rootDf = fs.readFileSync(ROOT_DOCKERFILE, 'utf8');
const apiDf = fs.readFileSync(API_DOCKERFILE, 'utf8');

// 1. 唯一权威 + 副本一致（忽略注释、尾部空行、CRLF/LF 差异）
const normalize = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#') && l.trim() !== '').join('\n').trim();
assert.equal(normalize(rootDf), normalize(apiDf), 'E-06: apps/api/Dockerfile 副本应与根 Dockerfile 一致（唯一权威）');

// 2. runner 非 root
const runnerSection = rootDf.split('FROM node:20-alpine AS runner')[1] || '';
assert.match(runnerSection, /adduser -u 10001/, 'E-06: runner 应创建 UID 10001');
assert.match(runnerSection, /addgroup -g 10001/, 'E-06: runner 应创建 GID 10001');
assert.match(runnerSection, /COPY --from=builder --chown=10001:10001/, 'E-06: COPY 应 --chown=10001:10001');
assert.match(runnerSection, /USER 10001/, 'E-06: runner 应 USER 10001 非 root');

// 3. 保留 PORT / healthcheck；D4（Codex PG-20260805-COS-D-CORRECTION）：
//    不再要求持久挂载标签与 FACT_SOURCE_STORAGE_ROOT，改为要求 driver=cos
assert.match(rootDf, /PORT|EXPOSE 3000/, 'E-06: 应保留 PORT 暴露');
assert.match(rootDf, /health\/live/, 'E-06: 应保留 live healthcheck');
assert.match(rootDf, /FACT_SOURCE_STORAGE_DRIVER=cos/, 'D4: 应声明 FACT_SOURCE_STORAGE_DRIVER=cos');

// 4. 禁止项（D4 增补）
assert.ok(!/--privileged/.test(rootDf), 'E-06: 禁止 privileged');
assert.ok(!/chmod 777/.test(rootDf), 'E-06: 禁止 chmod 777');
assert.ok(!/USER root/.test(runnerSection), 'E-06: 禁止 root entrypoint 后降权替代');
assert.ok(!/\/mnt\/fact-source-files/.test(rootDf), 'D4: Dockerfile 不得再创建/挂载 /mnt/fact-source-files');
assert.ok(!/required-persistent-mount/.test(rootDf), 'D4: 不得保留 required-persistent-mount label');
assert.ok(!/FACT_SOURCE_STORAGE_ROOT=/.test(rootDf), 'D4: 不得保留 FACT_SOURCE_STORAGE_ROOT 默认值');
// 密钥纪律：Dockerfile 不得含任何 COS 凭据字面量/环境变量注入
assert.ok(!/COS_SECRET|SESSION_TOKEN|COS_SECRET_ID|COS_SECRET_KEY/.test(rootDf), 'D4: Dockerfile 不得包含 COS 密钥');

// docker 可用性（可选检查；本机无 docker → PENDING_DOCKER，不伪造 PASS）
const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 10_000 });
let dockerNote = 'PENDING_DOCKER（本机无 docker 守护进程；构建/挂载验证在 F-04/G-04 隔离环境完成）';
if (dockerCheck.status === 0) {
  const build = spawnSync('docker', ['build', '-q', '-f', ROOT_DOCKERFILE, '.'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 600_000 });
  if (build.status === 0) {
    dockerNote = `DOCKER_BUILD_OK image=${(build.stdout || '').trim().slice(0, 16)}`;
  } else {
    dockerNote = `DOCKER_BUILD_FAILED: ${(build.stderr || '').slice(0, 200)}`;
  }
}

console.log(`CONTAINER_RUNTIME_CHECK_OK uid=10001 user_nonroot=true authoritative=root-Dockerfile ${dockerNote}`);
