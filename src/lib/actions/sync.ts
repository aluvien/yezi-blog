"use server";

import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { requireAdmin } from "@/lib/auth";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

type CommandResult = { stdout: string; stderr: string };

function runCommand(command: string, args: string[], cwd: string, timeout: number, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const rawDetail = String(stderr || stdout || error.message).trim();
        const detail = rawDetail.length > 1_400 ? `${rawDetail.slice(0, 700)}\n…\n${rawDetail.slice(-700)}` : rawDetail;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

type Pm2Process = { name?: string; pm2_env?: { pm_cwd?: string } };

function deploymentEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // 同步按钮不能等待 Git 询问账号密码，否则 Server Action 会一直挂起。
    GIT_TERMINAL_PROMPT: "0",
    PM2_HOME: process.env.PM2_HOME?.trim() || "/root/.pm2",
  };
}

async function findPm2Name(projectDir: string): Promise<string | null> {
  const configuredName = process.env.DEPLOY_PM2_NAME?.trim();
  if (configuredName) return configuredName;
  const result = await runCommand("pm2", ["jlist"], projectDir, 15_000, deploymentEnv());
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
    env: deploymentEnv(),
  });
  child.unref();
}

async function ensureDeploymentRepository(projectDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const root = await runCommand("git", ["rev-parse", "--show-toplevel"], projectDir, 15_000, env);
  if (path.resolve(root.stdout.trim()) !== path.resolve(projectDir)) {
    throw new Error(`部署目录不是 Git 仓库根目录：${projectDir}`);
  }

  const branch = await runCommand("git", ["branch", "--show-current"], projectDir, 15_000, env);
  if (branch.stdout.trim() !== "main") {
    throw new Error(`当前分支不是 main：${branch.stdout.trim() || "未知分支"}`);
  }

  const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=no"], projectDir, 15_000, env);
  if (status.stdout.trim()) {
    throw new Error("服务器有未提交的源码改动，已停止同步，避免覆盖本地修改");
  }
}

function getDatabasePath(projectDir: string): string {
  const configuredPath = process.env.BLOG_DB_PATH?.trim();
  if (process.env.NODE_ENV === "production" && !configuredPath) {
    throw new Error("生产环境未配置 BLOG_DB_PATH，已停止同步，避免误用其他数据库");
  }
  return path.resolve(configuredPath || path.join(projectDir, "data", "blog.db"));
}

/** 在服务端直接拉取 GitHub main 并部署，不再依赖外部 hook。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();

  try {
    const projectDir = path.resolve(process.env.DEPLOY_PROJECT_DIR?.trim() || "/www/wwwroot/yezi.me");
    if (!fs.existsSync(path.join(projectDir, "package.json"))) return { ok: false, error: `部署目录无效：${projectDir}` };

    const env = deploymentEnv();
    await ensureDeploymentRepository(projectDir, env);

    const databasePath = getDatabasePath(projectDir);
    if (!fs.existsSync(databasePath)) return { ok: false, error: `数据库不存在，已停止同步：${databasePath}` };

    const before = await runCommand("git", ["rev-parse", "--short", "HEAD"], projectDir, 15_000, env);
    // 先用 SQLite backup API 生成可恢复副本，再拉取代码和构建。
    await runCommand("npm", ["run", "backup"], projectDir, 60_000, env);
    await runCommand("git", ["pull", "--ff-only", "origin", "main"], projectDir, 120_000, env);
    const after = await runCommand("git", ["rev-parse", "--short", "HEAD"], projectDir, 15_000, env);

    // 以 package-lock.json 为准重装依赖，避免服务器残留旧版 Next/插件导致构建出现
    // “generate is not a function”这类本地构建无法复现的错误。npm ci 不会触碰 data/。
    await runCommand("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], projectDir, 300_000, env);
    await runCommand("npm", ["run", "build"], projectDir, 300_000, env);
    const processName = await findPm2Name(projectDir);
    if (!processName) return { ok: false, error: "代码同步并构建成功，但没有找到对应的 PM2 进程" };
    schedulePm2Restart(projectDir, processName);

    const changed = before.stdout.trim() !== after.stdout.trim();
    return {
      ok: true,
      message: changed ? "GitHub 代码已更新，数据库已备份，构建完成，服务正在重启。" : "代码已经是最新版本，数据库已备份，构建完成，服务正在重启。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步或部署异常";
    return { ok: false, error: `同步失败：${message}` };
  }
}
