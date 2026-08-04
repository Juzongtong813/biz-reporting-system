#!/usr/bin/env node
/**
 * 架构依赖方向检查（AR-R2 / AR-R4 / AR-R5 / AR-R6）
 * 只读检查，不修改任何文件。发现违规输出 [规则编号] 文件 :: 说明，并以非零码退出。
 *
 * 规则：
 *  R2-a  packages/*（共享契约层）不得依赖框架/基础设施（@nestjs、typeorm、react、vite、express）
 *  R2-b  apps/api 的 src 不得引用 apps/admin-web、apps/mini-program（后端不得反向依赖前端）
 *  R2-c  apps/admin-web 的 src 不得引用 apps/api 源码路径（前端只能经 API 契约通信）
 *  R2-d  app 启动装配（app.module/main）不得包含业务种子逻辑标记（seed*）——基线已知违规
 *  R4-a  packages/shared-types/src 不得存在生成物（.js/.d.ts/.map）
 *  R5-a  admin-web 页面层（features/**\/pages 或 pages/）不得直接调用 fetch( 或读写 localStorage token
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const violations = [];

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (["node_modules", "dist", ".git", "deploy-output", "uploads", "data"].includes(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

// R2-a
for (const pkg of ["packages/shared-types", "packages/shared-constants"]) {
  for (const f of walk(join(ROOT, pkg, "src"), [".ts"])) {
    if (f.endsWith(".d.ts")) continue;
    const src = readFileSync(f, "utf8");
    for (const bad of ["@nestjs/", "typeorm", "react", "vite", "express"]) {
      const re = new RegExp(`(from|require\\()\\s*['\"]${bad}`);
      if (re.test(src)) violations.push(`[AR-R2-a] ${rel(f)} :: 共享包依赖框架 ${bad}`);
    }
  }
}

// R2-b / R2-c
for (const f of walk(join(ROOT, "apps/api/src"), [".ts"])) {
  const src = readFileSync(f, "utf8");
  if (/from\s+['"].*(admin-web|mini-program)/.test(src))
    violations.push(`[AR-R2-b] ${rel(f)} :: 后端引用前端目录`);
}
for (const f of walk(join(ROOT, "apps/admin-web/src"), [".ts", ".tsx"])) {
  const src = readFileSync(f, "utf8");
  if (/from\s+['"].*apps\/api/.test(src))
    violations.push(`[AR-R2-c] ${rel(f)} :: 前端直接引用后端源码`);
}

// R2-d
for (const name of ["app.module.ts", "main.ts"]) {
  const p = join(ROOT, "apps/api/src", name);
  try {
    const src = readFileSync(p, "utf8");
    if (/seed\w*\(/i.test(src))
      violations.push(`[AR-R2-d] ${rel(p)} :: 启动装配包含业务种子逻辑(seed*)`);
  } catch {}
}

// R4-a
for (const f of walk(join(ROOT, "packages/shared-types/src"), [".js", ".d.ts", ".map"])) {
  violations.push(`[AR-R4-a] ${rel(f)} :: 生成物混入 src`);
}

// R5-a
for (const f of walk(join(ROOT, "apps/admin-web/src"), [".tsx", ".ts"])) {
  const r = rel(f);
  if (!/\/pages\//.test(r)) continue;
  const src = readFileSync(f, "utf8");
  if (/(?<![a-zA-Z])fetch\s*\(/.test(src))
    violations.push(`[AR-R5-a] ${r} :: 页面层直接调用 fetch()`);
  if (/localStorage\.(get|set)Item\(\s*['"](token|access_token)/.test(src))
    violations.push(`[AR-R5-a] ${r} :: 页面层直接读写 token`);
}

// ────────────── D3（Codex PG-20260805-COS-D-CORRECTION）──────────────

const COS_SDK_MODULE = "cos-nodejs-sdk-v5";
// 唯一允许直接 import/require COS SDK 的文件（设计 §4.2 :308 / :392）。
const COS_CLIENT_FACTORY = "apps/api/src/facts/storage/cos-client.factory.ts";
const COS_STORAGE_DIR = "apps/api/src/facts/storage/";

// AR-R7-a：业务层（apps/api/src 除 facts/storage/ 外）不得直接依赖 COS SDK
for (const f of walk(join(ROOT, "apps/api/src"), [".ts", ".js"])) {
  const r = rel(f);
  if (r.startsWith(COS_STORAGE_DIR)) continue; // 适配层允许（仅 factory 可 import，见下）
  const src = readFileSync(f, "utf8");
  if (new RegExp(`(from|require\\()\\s*['"]${COS_SDK_MODULE}`).test(src))
    violations.push(`[AR-R7-a] ${r} :: 业务层直接依赖 COS SDK（仅 ${COS_CLIENT_FACTORY} 允许）`);
}

// AR-R7-b：整个 COS SDK 的 import 只允许出现在 cos-client.factory.ts
for (const f of walk(join(ROOT, "apps/api/src"), [".ts", ".js"])) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  if (!new RegExp(`(from|require\\()\\s*['"]${COS_SDK_MODULE}`).test(src)) continue;
  if (r !== COS_CLIENT_FACTORY)
    violations.push(`[AR-R7-b] ${r} :: COS SDK 仅允许在 ${COS_CLIENT_FACTORY} 引用`);
}

// AR-R7-c：禁止公开/预签名 URL 与 ACL=public（设计 §4.3 :413 / :415）
const PUBLIC_EXPORT_LITERALS = [
  ["getObjectUrl", "预签名/公开对象 URL 生成"],
  ["getAuth\\(", "临时授权 URL 生成"],
  ["myqcloud\\.com", "公开桶域名"],
  ["cos\\.ap-", "公开桶 region 域名"],
];
for (const f of walk(join(ROOT, "apps/api/src"), [".ts", ".js"])) {
  const r = rel(f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // 允许注释提及禁止项（说明用途）
    for (const [literal, desc] of PUBLIC_EXPORT_LITERALS) {
      if (new RegExp(literal).test(line))
        violations.push(`[AR-R7-c] ${r}:${idx + 1} :: 禁止${desc}（${literal}）`);
    }
  });
}
// ACL=public：putObject 参数/配置不得含 public-read
for (const f of walk(join(ROOT, "apps/api/src"), [".ts", ".js"])) {
  const r = rel(f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (/ACL\s*[:=]\s*['"](public-read|public|private)[^'"']*['"]/.test(line))
      violations.push(`[AR-R7-c] ${r}:${idx + 1} :: 禁止显式 ACL（含 public-read）`);
  });
}

// AR-R7-d：禁止新增存储注入令牌（撤销 FACT_SOURCE_STORAGE Symbol 的门禁化）
for (const f of walk(join(ROOT, "apps/api/src"), [".ts"])) {
  const r = rel(f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // 允许注释说明已撤销令牌
    if (/FACT_SOURCE_STORAGE\s*=\s*Symbol/.test(line))
      violations.push(`[AR-R7-d] ${r}:${idx + 1} :: 禁止恢复 FACT_SOURCE_STORAGE Symbol 注入令牌`);
  });
}

// AR-R7-e：禁止恢复 CFS 运行时依赖（fuse.cosfs 挂载语义不得回归）
for (const f of walk(join(ROOT, "apps/api/src"), [".ts", ".js"])) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  if (/fuse\.cosfs|cosfs\s+.*rw/.test(src))
    violations.push(`[AR-R7-e] ${r} :: 禁止恢复 CFS cosfs 挂载依赖`);
}

if (violations.length) {
  console.error(`架构检查失败：${violations.length} 项违规`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
} else {
  console.log("架构检查通过：0 项违规");
}
