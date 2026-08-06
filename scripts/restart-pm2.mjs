import { execFileSync } from "node:child_process";

const processName = process.argv[2]?.trim();
if (!processName) process.exit(1);

// 先让 Server Action 返回成功，避免重启当前 Node 进程时中断按钮响应。
await new Promise((resolve) => setTimeout(resolve, 2000));
execFileSync("pm2", ["restart", processName, "--update-env"], {
  cwd: process.cwd(),
  stdio: "ignore",
});
