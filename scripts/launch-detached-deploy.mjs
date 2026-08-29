import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const runnerArgument = process.argv[2];
if (!runnerArgument) throw new Error("缺少部署脚本路径");

const projectDir = path.resolve(process.env.DEPLOY_PROJECT_DIR || process.cwd());
const runner = path.resolve(runnerArgument);
const logFile = path.resolve(process.env.DEPLOY_LOG_FILE || path.join(projectDir, "data", "deploy-release.log"));

if (!fs.existsSync(runner) || !fs.statSync(runner).isFile()) {
  throw new Error(`部署脚本不存在：${runner}`);
}

fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
const logFd = fs.openSync(logFile, "a", 0o600);
fs.chmodSync(logFile, 0o600);

try {
  fs.writeSync(logFd, `\n[deploy-launcher] ${new Date().toISOString()} launcher=${process.pid}\n`);
  const child = spawn(process.execPath, [runner], {
    cwd: projectDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      DEPLOY_ORPHAN_WORKER: "1",
      DEPLOY_LAUNCHER_PID: String(process.pid),
      DEPLOY_REQUIRE_ORPHAN: "1",
    },
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  process.stdout.write(`${JSON.stringify({ launcherPid: process.pid, workerPid: child.pid })}\n`);
} finally {
  fs.closeSync(logFd);
}
