import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureSqlite, resolveNodeGyp } from "../scripts/ensure-sqlite.mjs";

function fixture(t, binary = "incompatible") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yezi-sqlite-install-")));
  t.after(() => {
    try { assert.equal(fs.readFileSync(path.join(root, "blog.db"), "utf8"), "untouched site data"); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  const pkg = path.join(root, "node_modules", "better-sqlite3");
  const prebuild = path.join(pkg, "prebuilds", "host.node");
  fs.mkdirSync(path.dirname(prebuild), { recursive: true });
  fs.mkdirSync(path.join(pkg, "lib"));
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "better-sqlite3", version: "13.0.3", main: "index.cjs" }));
  fs.writeFileSync(prebuild, binary);
  fs.writeFileSync(path.join(pkg, "lib", "binding.js"), `
const fs = require('node:fs'), path = require('node:path');
exports.getPrebuildPath = () => {
  const file = path.join(__dirname, '..', 'prebuilds', 'host.node');
  return fs.existsSync(file) ? file : null;
};
`);
  fs.writeFileSync(path.join(pkg, "index.cjs"), `
const fs = require('node:fs'), path = require('node:path');
module.exports = class Database {
  constructor(filename, options = {}) {
    if (filename !== ':memory:') throw new Error('Real database must never be opened');
    if (process.env.TEST_SQLITE_QUERY_FAIL) throw new Error('Unexpected SQLite configuration error');
    const file = options.nativeBinding || require('./lib/binding.js').getPrebuildPath() || path.join(__dirname, 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(file)) throw Object.assign(new Error('Missing better_sqlite3.node'), { code: 'MODULE_NOT_FOUND' });
    if (fs.readFileSync(file, 'utf8') !== 'compatible') throw Object.assign(new Error("GLIBC_2.33 not found (required by host.node)"), { code: 'ERR_DLOPEN_FAILED' });
    if (process.env.TEST_SQLITE_DEFAULT_FAIL && !options.nativeBinding) throw new Error('Default entrypoint failed');
  }
  prepare(query) {
    if (query !== 'SELECT 1 AS ok') throw new Error('Unexpected query');
    return { get() { return { ok: 1 }; } };
  }
  exec(sql) { if (sql !== 'CREATE VIRTUAL TABLE probe USING fts5(content)') throw new Error('FTS5 was not tested'); }
  close() {}
};
`);
  const gyp = path.join(root, "fake-node-gyp.cjs");
  const events = path.join(root, "compile.json");
  fs.writeFileSync(gyp, `
const fs = require('node:fs'), path = require('node:path');
fs.writeFileSync(process.env.TEST_SQLITE_EVENTS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), executable: process.execPath }));
if (process.env.TEST_SQLITE_COMPILE_FAIL) { console.error('No C++ compiler'); process.exit(1); }
const output = path.join(process.cwd(), 'build', 'Release', 'better_sqlite3.node');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, process.env.TEST_SQLITE_BAD_BUILD ? 'still incompatible' : 'compatible');
`);
  const data = path.join(root, "blog.db");
  fs.writeFileSync(data, "untouched site data");
  const env = { ...process.env, npm_config_node_gyp: gyp, TEST_SQLITE_EVENTS: events, BLOG_DB_PATH: data };
  const ensure = (extra = {}) => ensureSqlite({ root, env: { ...env, ...extra }, log() {} });
  return { root, pkg, prebuild, gyp, events, ensure };
}

test("a working SQLite binary passes memory/FTS5 checks without compiling", (t) => {
  const f = fixture(t, "compatible");
  assert.deepEqual(f.ensure(), { rebuilt: false });
  assert.equal(fs.existsSync(f.events), false);
  assert.equal(fs.readFileSync(f.prebuild, "utf8"), "compatible");
});

test("a glibc mismatch forces a local build and replaces the preferred bundled prebuild", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.ensure(), { rebuilt: true });
  const event = JSON.parse(fs.readFileSync(f.events, "utf8"));
  assert.deepEqual(event.args, ["rebuild", "--release", "--force_build=1"]);
  assert.equal(event.cwd, fs.realpathSync(f.pkg));
  assert.equal(event.executable, process.execPath);
  assert.equal(fs.readFileSync(f.prebuild, "utf8"), "compatible");
  assert.deepEqual(f.ensure(), { rebuilt: false });
});

test("a missing native binary is compiled into the fallback build location", (t) => {
  const f = fixture(t);
  fs.rmSync(f.prebuild);
  assert.deepEqual(f.ensure(), { rebuilt: true });
  assert.equal(fs.existsSync(f.prebuild), false);
  assert.deepEqual(f.ensure(), { rebuilt: false });
});

test("failed compilation preserves the original binary and reports the real dependency failure", (t) => {
  const f = fixture(t);
  assert.throws(() => f.ensure({ TEST_SQLITE_COMPILE_FAIL: "1" }), /SQLite 本机编译失败.*GLIBC_2.33.*No C\+\+ compiler/);
  assert.equal(fs.readFileSync(f.prebuild, "utf8"), "incompatible");
});

test("an unusable compiled binary is rejected before replacing the bundled prebuild", (t) => {
  const f = fixture(t);
  assert.throws(() => f.ensure({ TEST_SQLITE_BAD_BUILD: "1" }), /编译产物校验失败/);
  assert.equal(fs.readFileSync(f.prebuild, "utf8"), "incompatible");
});

test("a failing default entrypoint restores the original prebuild", (t) => {
  const f = fixture(t);
  assert.throws(() => f.ensure({ TEST_SQLITE_DEFAULT_FAIL: "1" }), /默认加载校验失败/);
  assert.equal(fs.readFileSync(f.prebuild, "utf8"), "incompatible");
});

test("a non-native SQLite error fails immediately without trying to compile", (t) => {
  const f = fixture(t);
  assert.throws(() => f.ensure({ TEST_SQLITE_QUERY_FAIL: "1" }), /SQLite 自检失败.*Unexpected SQLite/);
  assert.equal(fs.existsSync(f.events), false);
});

test("node-gyp resolution uses npm's installed tool without fetching another package", (t) => {
  const f = fixture(t);
  assert.equal(resolveNodeGyp({ npm_config_node_gyp: f.gyp }), f.gyp);
  const npm = path.join(f.root, "npm");
  const gyp = path.join(npm, "node_modules", "node-gyp", "bin", "node-gyp.js");
  fs.mkdirSync(path.dirname(gyp), { recursive: true });
  fs.writeFileSync(gyp, "");
  fs.writeFileSync(path.join(npm, "node_modules", "node-gyp", "package.json"), '{"name":"node-gyp"}');
  const npmCli = path.join(npm, "npm-cli.js");
  fs.writeFileSync(npmCli, "");
  assert.equal(resolveNodeGyp({ npm_execpath: npmCli }), gyp);
});

test("normal installs and builds both check SQLite before Next builds", () => {
  const root = new URL("../", import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));
  assert.match(pkg.scripts.postinstall, /^node scripts\/ensure-sqlite\.mjs && /);
  const build = fs.readFileSync(new URL("scripts/build.mjs", root), "utf8");
  assert.ok(build.indexOf("ensureSqlite({ root, env })") < build.indexOf("const child = spawn("));
});
