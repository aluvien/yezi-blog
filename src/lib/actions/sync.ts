"use server";

import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { requireAdmin } from "@/lib/auth";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type ScheduleGithubRestartActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type GithubDeployStatus = {
  status: "unknown" | "queued" | "building" | "switching" | "checking" | "rolling_back" | "success" | "failed";
  updatedAt?: string;
  error?: string;
};

export type GithubVersionStatus = {
  status: "up-to-date" | "outdated" | "dirty" | "unavailable";
  localCommit?: string;
  remoteCommit?: string;
  error?: string;
};

type CommandResult = { stdout: string; stderr: string };

type GithubVersionCache = {
  expiresAt: number;
  result: GithubVersionStatus;
};

const GITHUB_VERSION_CACHE_MS = 30_000;
let githubVersionCache: GithubVersionCache | null = null;

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
  const env = { ...process.env };

  // 当前 Server Action 运行在 Next standalone 进程中。standalone 会把已经
  // JSON 序列化的配置写进 __NEXT_PRIVATE_STANDALONE_CONFIG；若子进程继承它，
  // `next build` 会跳过 next.config.ts，并因函数配置已丢失而构建失败。
  // 所有 __NEXT_PRIVATE_* 都是当前 Next 进程的内部状态，不应带入新的构建进程。
  // PM2/宝塔有时会为开发环境预设 TURBOPACK=1；本项目的生产构建明确使用
  // `next build --webpack`，两者同时存在会被 Next 16 直接判定为冲突。
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("__NEXT_PRIVATE_")
      || key === "TURBOPACK"
      || key.startsWith("TURBOPACK_")
      || key.startsWith("NEXT_TURBOPACK")
    ) {
      delete env[key];
    }
  }

  // GitHub 同步固定直连，避免宝塔、终端或旧环境变量把 Git 请求转发到
  // 不可用的代理，导致同步和版本检查出现“有时成功、有时失败”。
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "npm_config_proxy",
    "npm_config_https_proxy",
  ]) {
    delete env[key];
  }

  return {
    ...env,
    // 同步按钮不能等待 Git 询问账号密码，否则 Server Action 会一直挂起。
    GIT_TERMINAL_PROMPT: "0",
    PM2_HOME: process.env.PM2_HOME?.trim() || "/root/.pm2",
  };
}

function deploymentProjectDir(): string {
  return path.resolve(
    process.env.DEPLOY_PROJECT_DIR?.trim()
      || (process.env.NODE_ENV === "production" ? "/www/wwwroot/yezi.me" : process.cwd()),
  );
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function cacheGithubVersionStatus(result: GithubVersionStatus): GithubVersionStatus {
  githubVersionCache = { expiresAt: Date.now() + GITHUB_VERSION_CACHE_MS, result };
  return result;
}

function invalidateGithubVersionCache(): void {
  githubVersionCache = null;
}

async function findPm2Name(projectDir: string): Promise<string | null> {
  const configuredName = process.env.DEPLOY_PM2_NAME?.trim();
  try {
    const result = await runCommand("pm2", ["jlist"], projectDir, 15_000, deploymentEnv());
    const processes = JSON.parse(result.stdout) as Pm2Process[];
    if (configuredName) return processes.some((item) => item.name === configuredName) ? configuredName : null;
    const expectedDir = path.resolve(projectDir);
    const match = processes.find((item) => item.name && item.pm2_env?.pm_cwd && path.resolve(item.pm2_env.pm_cwd) === expectedDir);
    return match?.name ?? null;
  } catch {
    // 某些既有部署由 systemd/nohup 直接运行 Next，未安装 PM2 不是同步失败。
    return null;
  }
}

/** 在服务端直接拉取 GitHub main 并部署，不再依赖外部 hook。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();
  invalidateGithubVersionCache();
  try {
    const projectDir = deploymentProjectDir();
    if (!fs.existsSync(path.join(projectDir, "package.json"))) return { ok: false, error: `部署目录无效：${projectDir}` };
    const processName = await findPm2Name(projectDir);
    const envFile = path.resolve(process.env.BLOG_ENV_FILE?.trim() || path.join(projectDir, ".env.local"));
    if (!fs.existsSync(envFile)) return { ok: false, error: `缺少稳定外部环境文件：${envFile}` };
    if ((fs.statSync(envFile).mode & 0o077) !== 0) return { ok: false, error: "外部环境文件权限必须为 0600" };
    const releasesRoot = path.resolve(process.env.DEPLOY_RELEASES_DIR?.trim() || path.join(path.dirname(projectDir), "yezi-blog-releases"));
    if (fs.existsSync(path.join(releasesRoot, ".deploy.lock"))) return { ok: false, error: "已有一次部署正在执行，请等待健康检查或回滚完成" };

    const statusFile = path.join(process.env.BLOG_ROOT?.trim() || projectDir, "data", "deploy-status.json");
    fs.mkdirSync(path.dirname(statusFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statusFile, `${JSON.stringify({ status: "queued", updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    const runner = path.join(projectDir, "scripts", "deploy-release.mjs");
    if (!fs.existsSync(runner)) return { ok: false, error: "缺少 release 部署脚本" };
    const child = spawn(process.execPath, [runner], {
      cwd: projectDir,
      detached: true,
      stdio: "ignore",
      env: {
        ...deploymentEnv(),
        DEPLOY_PROJECT_DIR: projectDir,
        ...(processName ? { DEPLOY_PM2_NAME: processName, DEPLOY_RESTART_MODE: "pm2" } : { DEPLOY_RESTART_MODE: "direct" }),
        DEPLOY_STATUS_FILE: statusFile,
        BLOG_ENV_FILE: envFile,
      },
    });
    child.unref();
    return {
      ok: true,
      message: processName
        ? "已启动独立 release 部署任务；构建、切换、健康检查与失败回滚将在服务器端完成。"
        : "已启动独立 release 部署任务；将替换 3030 端口上的旧 Next 进程并完成健康检查。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步或部署异常";
    return { ok: false, error: `同步失败：${message}` };
  }
}

/**
 * 在同步/构建的成功响应已送达浏览器后才安排 PM2 重启。
 *
 * 这必须和 syncLatestGithubAction 分开：PM2 重启当前 standalone 进程会中断
 * 正在传输的 Server Action Flight 响应，导致前端第一次点击显示通用网络错误。
 */
export async function scheduleGithubRestartAction(): Promise<ScheduleGithubRestartActionResult> {
  await requireAdmin();
  return { ok: false, error: "release 部署已由服务器任务统一负责重启，不再接受独立重启请求" };
}

/** 查询 detached PM2 重启脚本写入的最终状态，供设置页确认重启是否完成。 */
export async function getGithubDeployStatusAction(): Promise<GithubDeployStatus> {
  await requireAdmin();
  const projectDir = deploymentProjectDir();
  const statusFile = path.join(projectDir, "data", "deploy-status.json");
  try {
    const value = JSON.parse(fs.readFileSync(statusFile, "utf8")) as Partial<GithubDeployStatus>;
    if (["queued", "building", "switching", "checking", "rolling_back", "success", "failed"].includes(value.status ?? "")) {
      return { status: value.status as GithubDeployStatus["status"], updatedAt: value.updatedAt, error: value.error };
    }
  } catch {
    // 状态文件还未生成或正在被重启脚本替换。
  }
  return { status: "unknown" };
}

/**
 * 检查服务器当前提交是否与 GitHub origin/main 一致。
 * 只执行只读 Git 命令，不会拉取代码、构建项目或修改数据库。
 */
export async function getGithubVersionStatusAction(): Promise<GithubVersionStatus> {
  await requireAdmin();

  if (githubVersionCache && githubVersionCache.expiresAt > Date.now()) {
    return githubVersionCache.result;
  }

  const projectDir = deploymentProjectDir();
  const env = deploymentEnv();

  try {
    const root = await runCommand("git", ["rev-parse", "--show-toplevel"], projectDir, 5_000, env);
    if (path.resolve(root.stdout.trim()) !== projectDir) {
      return cacheGithubVersionStatus({
        status: "unavailable",
        error: "部署目录不是 Git 仓库根目录",
      });
    }

    const branch = await runCommand("git", ["branch", "--show-current"], projectDir, 5_000, env);
    if (branch.stdout.trim() !== "main") {
      return cacheGithubVersionStatus({
        status: "unavailable",
        error: `服务器当前分支不是 main${branch.stdout.trim() ? `（${branch.stdout.trim()}）` : ""}`,
      });
    }

    const local = await runCommand("git", ["rev-parse", "HEAD"], projectDir, 5_000, env);
    const localCommit = local.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{40}$/i.test(localCommit)) throw new Error("无法读取服务器当前提交");

    const changes = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=no"], projectDir, 5_000, env);
    if (changes.stdout.trim()) {
      return cacheGithubVersionStatus({
        status: "dirty",
        localCommit: shortCommit(localCommit),
        error: "服务器存在未提交的源码改动，同步前需要先处理这些改动",
      });
    }

    const remote = await runCommand("git", ["ls-remote", "origin", "refs/heads/main"], projectDir, 8_000, env);
    const remoteCommit = remote.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{40}$/i.test(remoteCommit)) throw new Error("GitHub 没有返回 origin/main 的有效提交");

    return cacheGithubVersionStatus({
      status: localCommit === remoteCommit ? "up-to-date" : "outdated",
      localCommit: shortCommit(localCommit),
      remoteCommit: shortCommit(remoteCommit),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    console.warn(`[github-version-check] ${detail}`);
    return cacheGithubVersionStatus({
      status: "unavailable",
      error: "暂时无法连接 GitHub 检查最新版本，请稍后重试",
    });
  }
}
