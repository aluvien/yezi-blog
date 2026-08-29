"use server";

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
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
        const wrapped = new Error(detail);
        if (typeof (error as NodeJS.ErrnoException).code === "string") {
          (wrapped as NodeJS.ErrnoException).code = (error as NodeJS.ErrnoException).code;
        }
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

type Pm2Process = { name?: string; pm2_env?: { pm_cwd?: string } };

type DeploymentSupervisor =
  | { mode: "pm2"; processName: string }
  | { mode: "direct" }
  | { mode: "unavailable"; error: string };

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

/** PM2 may prefix `jlist` with an update notice; extract the JSON payload safely. */
function parsePm2ProcessList(output: string): Pm2Process[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("PM2 jlist 没有返回进程 JSON");
  try {
    const processes = JSON.parse(output.slice(start, end + 1));
    if (!Array.isArray(processes)) throw new Error("not an array");
    return processes as Pm2Process[];
  } catch {
    throw new Error("PM2 jlist 返回格式无效");
  }
}

function isPm2CommandMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function managedProjectDirectories(projectDir: string): Set<string> {
  const directories = new Set([path.resolve(projectDir)]);
  const currentLink = path.resolve(process.env.DEPLOY_CURRENT_LINK?.trim() || path.join(path.dirname(projectDir), "yezi-blog-current"));
  try {
    directories.add(fs.realpathSync(currentLink));
  } catch {
    // The initial deployment may not have created the release symlink yet.
  }
  return directories;
}

/**
 * Resolve the process supervisor conservatively. A PM2 query that is broken or
 * ambiguous must never make us kill the HTTP port as though it were unmanaged.
 */
async function resolveDeploymentSupervisor(projectDir: string): Promise<DeploymentSupervisor> {
  const configuredName = process.env.DEPLOY_PM2_NAME?.trim();
  const explicitlyDirect = process.env.DEPLOY_RESTART_MODE === "direct";
  if (explicitlyDirect && !configuredName) return { mode: "direct" };
  try {
    const result = await runCommand("pm2", ["jlist"], projectDir, 15_000, deploymentEnv());
    const processes = parsePm2ProcessList(result.stdout);
    if (configuredName) {
      if (processes.some((item) => item.name === configuredName)) return { mode: "pm2", processName: configuredName };
      return { mode: "unavailable", error: `PM2 中未找到配置的进程 ${configuredName}，已取消部署以避免误停 3030 端口` };
    }
    const expectedDirectories = managedProjectDirectories(projectDir);
    const match = processes.find((item) => item.name && item.pm2_env?.pm_cwd && expectedDirectories.has(path.resolve(item.pm2_env.pm_cwd)));
    if (match?.name) return { mode: "pm2", processName: match.name };
    if (explicitlyDirect) return { mode: "direct" };
    return { mode: "unavailable", error: "未识别到当前项目的 PM2 进程；如确为非 PM2 直启部署，请显式设置 DEPLOY_RESTART_MODE=direct" };
  } catch (error) {
    // A machine without PM2 is the only implicit direct-deployment case. Any
    // other failure could mean the PM2 daemon is still supervising 3030.
    if (!configuredName && isPm2CommandMissing(error)) return { mode: "direct" };
    const detail = error instanceof Error ? error.message : "未知错误";
    return { mode: "unavailable", error: `无法确认 PM2 进程状态（${detail}）；已取消部署以避免误停 3030 端口` };
  }
}

/** 在服务端直接拉取 GitHub main 并部署，不再依赖外部 hook。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();
  invalidateGithubVersionCache();
  try {
    const projectDir = deploymentProjectDir();
    if (!fs.existsSync(path.join(projectDir, "package.json"))) return { ok: false, error: `部署目录无效：${projectDir}` };
    const supervisor = await resolveDeploymentSupervisor(projectDir);
    if (supervisor.mode === "unavailable") return { ok: false, error: supervisor.error };
    const envFile = path.resolve(process.env.BLOG_ENV_FILE?.trim() || path.join(projectDir, ".env.local"));
    if (!fs.existsSync(envFile)) return { ok: false, error: `缺少稳定外部环境文件：${envFile}` };
    if ((fs.statSync(envFile).mode & 0o077) !== 0) return { ok: false, error: "外部环境文件权限必须为 0600" };
    const releasesRoot = path.resolve(process.env.DEPLOY_RELEASES_DIR?.trim() || path.join(path.dirname(projectDir), "yezi-blog-releases"));
    if (fs.existsSync(path.join(releasesRoot, ".deploy.lock"))) return { ok: false, error: "已有一次部署正在执行，请等待健康检查或回滚完成" };

    const statusFile = path.join(process.env.BLOG_ROOT?.trim() || projectDir, "data", "deploy-status.json");
    const runner = path.join(projectDir, "scripts", "deploy-release.mjs");
    const launcher = path.join(projectDir, "scripts", "launch-detached-deploy.mjs");
    if (!fs.existsSync(runner)) return { ok: false, error: "缺少 release 部署脚本" };
    if (!fs.existsSync(launcher)) return { ok: false, error: "缺少独立部署启动器" };
    fs.mkdirSync(path.dirname(statusFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statusFile, `${JSON.stringify({ status: "queued", updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    const logFile = path.join(path.dirname(statusFile), "deploy-release.log");
    const launchEnv = {
      ...deploymentEnv(),
      DEPLOY_PROJECT_DIR: projectDir,
      ...(supervisor.mode === "pm2"
        ? { DEPLOY_PM2_NAME: supervisor.processName, DEPLOY_RESTART_MODE: "pm2" }
        : { DEPLOY_RESTART_MODE: "direct" }),
      DEPLOY_STATUS_FILE: statusFile,
      DEPLOY_LOG_FILE: logFile,
      DEPLOY_REQUIRE_ORPHAN: "1",
      BLOG_ENV_FILE: envFile,
    };

    // A merely `detached` child still has this Next process as its parent.
    // PM2 recursively kills that child tree when switching the managed app,
    // which used to terminate the deployer immediately after `pm2 delete`.
    // The short-lived launcher exits first, so the real worker is reparented
    // outside the web process tree before it may touch PM2.
    try {
      await runCommand(process.execPath, [launcher, runner], projectDir, 10_000, launchEnv);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      fs.writeFileSync(statusFile, `${JSON.stringify({ status: "failed", updatedAt: new Date().toISOString(), error: `无法启动独立部署任务：${detail}` })}\n`, { mode: 0o600 });
      throw error;
    }
    return {
      ok: true,
      message: supervisor.mode === "pm2"
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

/** 查询后台 release 部署任务写入的状态，供设置页确认部署与健康检查结果。 */
export async function getGithubDeployStatusAction(): Promise<GithubDeployStatus> {
  await requireAdmin();
  const projectDir = deploymentProjectDir();
  // 必须与 syncLatestGithubAction 使用同一根目录，否则 BLOG_ROOT 与部署目录不同时，
  // 后台会持续读到旧状态，App 也无法获知 release 部署的真实进度。
  const statusFile = path.join(process.env.BLOG_ROOT?.trim() || projectDir, "data", "deploy-status.json");
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
