import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { deploymentCommandEnv, resolvePm2Command } from "../scripts/pm2-command.mjs";

const execFileAsync = promisify(execFile);

function fixture(context) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yezi-pm2-command-")));
  const execPath = path.join(root, "node", "bin", "node");
  fs.mkdirSync(path.dirname(execPath), { recursive: true });
  fs.symlinkSync(process.execPath, execPath);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, execPath };
}

function writeCli(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ args: process.argv.slice(2), home: process.env.PM2_HOME }));\n', { mode: 0o600 });
  return file;
}

test("PM2 beside the running Node works without an interactive shell PATH", async (context) => {
  const { root, execPath } = fixture(context);
  const bin = writeCli(path.join(path.dirname(execPath), "pm2"));
  const resolved = resolvePm2Command({ env: { PATH: "/no-shell-path", PM2_HOME: "/custom/pm2-home" }, execPath, cwd: root });
  assert.equal(resolved.bin, bin);
  const { stdout } = await execFileAsync(resolved.command, [...resolved.args, "jlist"], { env: resolved.env });
  assert.deepEqual(JSON.parse(stdout), { args: ["jlist"], home: "/custom/pm2-home" });
  assert.equal(resolved.env.PATH.split(path.delimiter)[0], path.dirname(execPath));
});

test("explicit PM2 paths are pinned instead of falling back to another installation", (context) => {
  const { root, execPath } = fixture(context);
  writeCli(path.join(path.dirname(execPath), "pm2"));
  const actual = writeCli(path.join(root, "custom", "pm2"));
  const link = path.join(root, "pm2-link");
  fs.symlinkSync(actual, link);
  assert.equal(resolvePm2Command({ env: { DEPLOY_PM2_BIN: link }, execPath, cwd: root }).bin, actual);
  assert.throws(() => resolvePm2Command({ env: { DEPLOY_PM2_BIN: path.join(root, "missing") }, execPath, cwd: root }), /DEPLOY_PM2_BIN.*不可用/);
});

test("npm prefix and global module locations work without a bin symlink", (context) => {
  const { root, execPath } = fixture(context);
  const prefix = path.join(root, "npm-global");
  const bin = writeCli(path.join(prefix, "lib", "node_modules", "pm2", "bin", "pm2"));
  assert.equal(resolvePm2Command({ env: { npm_config_prefix: prefix }, execPath, cwd: root }).bin, bin);
  assert.equal(resolvePm2Command({ env: { NPM_CONFIG_PREFIX: prefix }, execPath, cwd: root }).bin, bin);
  const nodeGlobal = writeCli(path.join(root, "node", "lib", "node_modules", "pm2", "bin", "pm2"));
  assert.equal(resolvePm2Command({ env: {}, execPath, cwd: root }).bin, nodeGlobal);
});

test("PATH and project-local PM2 installations are resolved to absolute files", (context) => {
  const { root, execPath } = fixture(context);
  const local = writeCli(path.join(root, "node_modules", "pm2", "bin", "pm2"));
  assert.equal(resolvePm2Command({ env: {}, execPath, cwd: root }).bin, local);
  const inPath = writeCli(path.join(root, "custom-bin", "pm2"));
  assert.equal(resolvePm2Command({ env: { PATH: "custom-bin" }, execPath, cwd: root }).bin, inPath);
});

test("executable wrappers remain executable and invalid candidates cannot become a command", async (context) => {
  const { root, execPath } = fixture(context);
  const wrapper = path.join(root, "pm2-wrapper");
  fs.writeFileSync(wrapper, '#!/bin/sh\nprintf "[]"\n', { mode: 0o700 });
  const resolved = resolvePm2Command({ env: { DEPLOY_PM2_BIN: wrapper }, execPath, cwd: root });
  assert.equal(resolved.command, wrapper);
  assert.deepEqual(resolved.args, []);
  assert.equal((await execFileAsync(resolved.command, ["jlist"], { env: resolved.env })).stdout, "[]");
  fs.chmodSync(wrapper, 0o600);
  assert.throws(() => resolvePm2Command({ env: { DEPLOY_PM2_BIN: wrapper }, execPath, cwd: root }), /不可用/);
  fs.mkdirSync(path.join(path.dirname(execPath), "pm2"));
  assert.throws(() => resolvePm2Command({ env: {}, execPath, cwd: root }), { code: "EACCES" });
});

test("deployment command PATH preserves inherited variables and avoids duplicate Node entries", () => {
  const nodeDirectory = path.dirname(process.execPath);
  const env = { PATH: `${nodeDirectory}${path.delimiter}/usr/bin`, PM2_HOME: "/existing/pm2" };
  assert.deepEqual(deploymentCommandEnv(env), env);
  assert.ok(deploymentCommandEnv().PATH);
  assert.throws(() => resolvePm2Command({ env: { DEPLOY_PM2_BIN: "/missing/explicit/pm2" } }), /DEPLOY_PM2_BIN/);
});
