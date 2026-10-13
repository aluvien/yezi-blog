import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { acquireProcessLock, releaseProcessLock, isProcessLockBusy } from "../scripts/process-lock.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-process-lock-"));
const helper = new URL("../scripts/process-lock.mjs", import.meta.url).href;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function lockPath(t) { return path.join(root, t.name.replaceAll(/[^a-z0-9]/gi, "-")); }
async function childOwner(file, legacy = false) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs'; import {acquireProcessLock} from ${JSON.stringify(helper)};
    const file=process.argv[1];
    ${legacy ? "fs.openSync(file,'wx'); fs.utimesSync(file,new Date(0),new Date(0));" : "acquireProcessLock(file);"}
    process.stdout.write('ready'); setInterval(()=>{},1000);
  `, file], { stdio: ["ignore", "pipe", "pipe"] });
  await once(child.stdout, "data");
  return child;
}
async function kill(child) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }

test("active owners cannot be stolen even when the lock is old", t => {
  const file = lockPath(t); const lock = acquireProcessLock(file);
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.equal(isProcessLockBusy(file), true);
  assert.throws(() => acquireProcessLock(file), /已有任务/);
  releaseProcessLock(lock); assert.equal(isProcessLockBusy(file), false);
});
test("killed owners are recovered and stale releases cannot remove their successor", async t => {
  const file = lockPath(t); const child = await childOwner(file);
  const oldOwner = fs.readdirSync(file)[0];
  try { assert.equal(isProcessLockBusy(file), true); } finally { await kill(child); }
  const next = acquireProcessLock(file);
  releaseProcessLock({ file, owner: oldOwner });
  assert.equal(isProcessLockBusy(file), true);
  releaseProcessLock(next);
});
test("legacy locks remain held while their descriptor is open, and recover after death", async t => {
  const file = lockPath(t); const child = await childOwner(file, true);
  try { assert.equal(isProcessLockBusy(file), true); } finally { await kill(child); }
  const next = acquireProcessLock(file); releaseProcessLock(next);
  assert.equal(fs.existsSync(file), false);
});
test("fresh legacy files are protected while their owner is initializing", t => {
  const file = lockPath(t); fs.writeFileSync(file, "");
  assert.throws(() => acquireProcessLock(file), /已有任务/);
});
test("an interrupted owner removal leaves an empty directory that is recoverable", t => {
  const file = lockPath(t); fs.mkdirSync(file);
  const lock = acquireProcessLock(file); releaseProcessLock(lock);
});
test("unreadable or unexpected owner records fail closed", t => {
  const file = lockPath(t); fs.mkdirSync(file); fs.writeFileSync(path.join(file, "unexpected"), "");
  assert.equal(isProcessLockBusy(file), true);
});
test("simultaneous contenders recovering a dead owner have only one winner", async t => {
  const file = lockPath(t); const dead = await childOwner(file); await kill(dead);
  const children = Array.from({ length: 4 }, () => spawn(process.execPath, ["--input-type=module", "-e", `
    import {acquireProcessLock} from ${JSON.stringify(helper)};
    process.on('message',()=>{try{acquireProcessLock(process.argv[1]);process.send('won');}catch{process.send('busy');}});
    process.send('ready');
  `, file], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
  try {
    await Promise.all(children.map(child => once(child, "message")));
    const results = children.map(child => { const result = once(child, "message"); child.send("go"); return result; });
    assert.equal((await Promise.all(results)).filter(([value]) => value === "won").length, 1);
  } finally { await Promise.all(children.map(kill)); }
  assert.equal(isProcessLockBusy(file), false);
});
