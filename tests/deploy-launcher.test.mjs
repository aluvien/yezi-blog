import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待测试 worker 超时：${filePath}`);
}

test("deployment worker is reparented before it can switch the PM2 app", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-launcher-"));
  const worker = path.join(temporary, "worker.mjs");
  const resultFile = path.join(temporary, "worker.json");
  const logFile = path.join(temporary, "deploy.log");
  const launcher = path.resolve("scripts/launch-detached-deploy.mjs");
  let workerPid;

  fs.writeFileSync(worker, `
    import fs from "node:fs";
    setTimeout(() => {
      fs.writeFileSync(process.env.DETACHED_TEST_RESULT, JSON.stringify({
        pid: process.pid,
        ppid: process.ppid,
        orphanWorker: process.env.DEPLOY_ORPHAN_WORKER,
        requireOrphan: process.env.DEPLOY_REQUIRE_ORPHAN,
      }));
    }, 100);
    setInterval(() => {}, 1000);
  `);

  try {
    const { stdout } = await execFileAsync(process.execPath, [launcher, worker], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        DEPLOY_PROJECT_DIR: path.resolve("."),
        DEPLOY_LOG_FILE: logFile,
        DETACHED_TEST_RESULT: resultFile,
      },
      timeout: 5_000,
    });
    const launched = JSON.parse(stdout);
    workerPid = launched.workerPid;
    await waitForFile(resultFile);
    const workerState = JSON.parse(fs.readFileSync(resultFile, "utf8"));

    assert.equal(workerState.pid, workerPid);
    assert.notEqual(workerState.ppid, launched.launcherPid);
    assert.equal(workerState.orphanWorker, "1");
    assert.equal(workerState.requireOrphan, "1");
    assert.match(fs.readFileSync(logFile, "utf8"), /deploy-launcher/);
    assert.equal(fs.statSync(logFile).mode & 0o077, 0);
  } finally {
    if (workerPid) {
      try { process.kill(workerPid, "SIGTERM"); } catch { /* The test worker may already have exited. */ }
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
