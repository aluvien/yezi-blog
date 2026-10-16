import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probeScript = `
const { createRequire } = require('node:module');
try {
  const load = createRequire(process.argv[1]);
  const Database = load('better-sqlite3');
  const db = new Database(':memory:', process.argv[2] ? { nativeBinding: process.argv[2] } : {});
  try {
    if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite query failed');
    db.exec('CREATE VIRTUAL TABLE probe USING fts5(content)');
  } finally { db.close(); }
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code, message: error.message }));
  process.exitCode = 1;
}
`;

function probe(root, env, nativeBinding) {
  // A separate process avoids retaining the incompatible addon in require's
  // cache. Only an in-memory database is opened, never the site's data file.
  const result = spawnSync(process.execPath, ["-e", probeScript, path.join(root, "package.json"), ...(nativeBinding ? [nativeBinding] : [])], {
    cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024,
  });
  let report;
  try { report = JSON.parse(result.stdout.trim()); } catch { /* Startup failures have no JSON report. */ }
  return result.status === 0 && report?.ok
    ? { ok: true }
    : { ok: false, code: report?.code, message: report?.message || result.error?.message || result.stderr?.trim() || "SQLite 检测进程失败" };
}

export function resolveNodeGyp(env = process.env) {
  const candidates = [env.npm_config_node_gyp];
  if (env.npm_execpath && path.isAbsolute(env.npm_execpath)) {
    try { candidates.push(createRequire(env.npm_execpath).resolve("node-gyp/bin/node-gyp.js")); } catch { /* Try the Node installation next. */ }
  }
  candidates.push(path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"));
  return candidates.find((file) => file && path.isAbsolute(file) && fs.existsSync(file)) || null;
}

function nativeLoadFailure(result) {
  return result.code === "ERR_DLOPEN_FAILED"
    || ((result.code === "MODULE_NOT_FOUND" || result.code === "ENOENT") && /\.node\b|bindings file/i.test(result.message));
}

export function ensureSqlite({ root = projectRoot, env = process.env, log = console.log } = {}) {
  const initial = probe(root, env);
  if (initial.ok) return { rebuilt: false };
  if (!nativeLoadFailure(initial)) throw new Error(`SQLite 自检失败：${initial.message}`);

  const load = createRequire(path.join(root, "package.json"));
  const packageRoot = path.dirname(load.resolve("better-sqlite3/package.json"));
  const nodeGyp = resolveNodeGyp(env);
  if (!nodeGyp) throw new Error("SQLite 原生模块不兼容，且未找到 npm 自带的 node-gyp；请使用完整 Node.js/npm 安装后重试");
  log("[sqlite] 预编译模块无法加载，正在使用本机系统库编译（需要 Python 3、make 和 C++ 编译器）");
  const build = spawnSync(process.execPath, [nodeGyp, "rebuild", "--release", "--force_build=1"], {
    cwd: packageRoot,
    env: { ...env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ""}` },
    encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (build.error || build.status !== 0) {
    const detail = String(build.error?.message || build.stderr || build.stdout || "编译进程失败").trim().slice(-2_000);
    throw new Error(`SQLite 本机编译失败，请检查 Python 3、make、C++ 编译器和 Node 头文件下载；原生错误：${initial.message}；${detail}`);
  }
  const compiled = path.join(packageRoot, "build", "Release", "better_sqlite3.node");
  const compiledCheck = probe(root, env, compiled);
  if (!compiledCheck.ok) throw new Error(`SQLite 编译产物校验失败：${compiledCheck.message}`);

  // v13 selects a bundled prebuild before build/Release. Replace only this
  // machine's binary, after checking it, so Next's standalone tracing also
  // packages the compatible file. npm ci will recreate and recheck it next time.
  const loader = path.join(packageRoot, "lib", "binding.js");
  const prebuild = fs.existsSync(loader) ? load(loader).getPrebuildPath?.() : null;
  let original;
  if (prebuild) {
    original = fs.readFileSync(prebuild);
    const temporary = `${prebuild}.${process.pid}.tmp`;
    try {
      fs.copyFileSync(compiled, temporary);
      fs.renameSync(temporary, prebuild);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  const final = probe(root, env);
  if (!final.ok) {
    if (prebuild) fs.writeFileSync(prebuild, original);
    throw new Error(`SQLite 默认加载校验失败：${final.message}`);
  }
  log("[sqlite] 本机编译及内存数据库/FTS5 自检通过");
  return { rebuilt: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { ensureSqlite(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
