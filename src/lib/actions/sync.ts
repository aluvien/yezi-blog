"use server";

import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { requireAdmin } from "@/lib/auth";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

type CommandResult = { stdout: string; stderr: string };

function runCommand(command: string, args: string[], cwd: string, timeout: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().slice(-500);
        reject(new Error(detail));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

type Pm2Process = { name?: string; pm2_env?: { pm_cwd?: string } };

async function findPm2Name(projectDir: string): Promise<string | null> {
  const configuredName = process.env.DEPLOY_PM2_NAME?.trim();
  if (configuredName) return configuredName;
  const result = await runCommand("pm2", ["jlist"], projectDir, 15_000);
  const processes = JSON.parse(result.stdout) as Pm2Process[];
  const expectedDir = path.resolve(projectDir);
  const match = processes.find((item) => item.name && item.pm2_env?.pm_cwd && path.resolve(item.pm2_env.pm_cwd) === expectedDir);
  return match?.name ?? null;
}

function schedulePm2Restart(projectDir: string, processName: string): void {
  const restartScript = path.join(projectDir, "scripts", "restart-pm2.mjs");
  if (!fs.existsSync(restartScript)) throw new Error("缺少 PM2 重启脚本，请先同步最新源码");
  const child = spawn(process.execPath, [restartScript, processName], {
    cwd: projectDir,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

/** 在服务端触发服务器拉取 GitHub main 并部署，避免把 access_key 暴露给浏览器。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();

  const hookUrl = process.env.GITHUB_SYNC_HOOK_URL?.trim();
  if (!hookUrl) return { ok: false, error: "未配置 GITHUB_SYNC_HOOK_URL" };

  try {
    const response = await fetch(hookUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      // hook 返回非 JSON 时按失败处理，并在界面显示状态码。
    }

    if (!response.ok) return { ok: false, error: `同步请求失败（HTTP ${response.status}）` };
    if (payload && typeof payload === "object" && "code" in payload && Number(payload.code) === 1) {
      const projectDir = process.env.DEPLOY_PROJECT_DIR?.trim() || "/www/wwwroot/yezi.me";
      if (!fs.existsSync(path.join(projectDir, "package.json"))) return { ok: false, error: `源码已同步，但部署目录无效：${projectDir}` };

      try {
        await runCommand("npm", ["run", "build"], projectDir, 180_000);
        const processName = await findPm2Name(projectDir);
        if (!processName) return { ok: false, error: "源码已同步并构建成功，但没有找到对应的 PM2 进程" };
        schedulePm2Restart(projectDir, processName);
        return { ok: true, message: "同步成功，构建已完成，服务正在重启。" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "构建或重启失败";
        return { ok: false, error: `源码已同步，但部署失败：${message}` };
      }
    }

    const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message ?? "") : "";
    return { ok: false, error: message || "服务器未确认同步成功" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求异常";
    return { ok: false, error: `同步请求失败：${message}` };
  }
}
