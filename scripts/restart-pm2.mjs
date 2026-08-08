import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const processName = process.argv[2]?.trim();
if (!processName) process.exit(1);

function writeStatus(status, extra = {}) {
  const file = process.env.DEPLOY_STATUS_FILE;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // 目录通常已经存在，写入失败时继续尝试最终重启。
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ status, processName, updatedAt: new Date().toISOString(), ...extra }), { mode: 0o600 });
  } catch {
    // 状态记录失败不能阻止 PM2 重启。
  }
}

// 先让 Server Action 返回成功，避免重启当前 Node 进程时中断按钮响应。
await new Promise((resolve) => setTimeout(resolve, 2000));
try {
  const pm2Env = { ...process.env };
  delete pm2Env.DEPLOY_STATUS_FILE;
  execFileSync("pm2", ["restart", processName, "--update-env"], { cwd: process.cwd(), stdio: "ignore", env: pm2Env });
  writeStatus("success");
} catch (error) {
  writeStatus("failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
