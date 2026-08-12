"use server";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { requireAdmin } from "@/lib/auth";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type GithubDeployStatus = {
  status: "unknown" | "restarting" | "success" | "failed";
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
  const statusFile = path.join(projectDir, "data", "deploy-status.json");
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify({ status: "restarting", processName, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  const child = spawn(process.execPath, [restartScript, processName], {
    cwd: projectDir,
    detached: true,
    stdio: "ignore",
    env: { ...deploymentEnv(), DEPLOY_STATUS_FILE: statusFile },
  });
  child.unref();
}

function fileDigest(filePath: string): string {
  if (!fs.existsSync(filePath)) return "missing";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function acquireDeploymentLock(projectDir: string): () => void {
  const lockPath = path.join(projectDir, ".deploy-sync.lock");
  const staleAfterMs = 30 * 60 * 1000;
  const tryOpen = (): number => fs.openSync(lockPath, "wx", 0o600);
  let fd: number;
  try {
    fd = tryOpen();
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs < staleAfterMs) {
        throw new Error("已有一次同步正在执行，请等待当前同步完成");
      }
      fs.unlinkSync(lockPath);
      fd = tryOpen();
    } catch (retryError) {
      if (retryError instanceof Error && retryError.message.includes("已有一次同步")) throw retryError;
      throw new Error("无法取得同步锁，请稍后重试");
    }
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);
  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // 同步异常或服务器清理锁文件时无需影响响应。
    }
  };
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
  return path.resolve(configuredPath || path.join(projectDir, "data", "blog.db"));
}

/** 在服务端直接拉取 GitHub main 并部署，不再依赖外部 hook。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();
  invalidateGithubVersionCache();
  let releaseLock: (() => void) | null = null;

  try {
    const projectDir = deploymentProjectDir();
    if (!fs.existsSync(path.join(projectDir, "package.json"))) return { ok: false, error: `部署目录无效：${projectDir}` };
    releaseLock = acquireDeploymentLock(projectDir);

    const env = deploymentEnv();
    await ensureDeploymentRepository(projectDir, env);

    const databasePath = getDatabasePath(projectDir);
    if (!fs.existsSync(databasePath)) return { ok: false, error: `数据库不存在，已停止同步：${databasePath}` };

    const before = await runCommand("git", ["rev-parse", "--short", "HEAD"], projectDir, 15_000, env);
    const packageBefore = fileDigest(path.join(projectDir, "package.json"));
    const lockBefore = fileDigest(path.join(projectDir, "package-lock.json"));
    // 先用 SQLite backup API 生成可恢复副本，再拉取代码和构建。
    await runCommand("npm", ["run", "backup"], projectDir, 60_000, env);
    await runCommand("git", ["pull", "--ff-only", "origin", "main"], projectDir, 120_000, env);
    const after = await runCommand("git", ["rev-parse", "--short", "HEAD"], projectDir, 15_000, env);

    const dependencyFilesChanged = packageBefore !== fileDigest(path.join(projectDir, "package.json"))
      || lockBefore !== fileDigest(path.join(projectDir, "package-lock.json"));
    const dependencyDirMissing = !fs.existsSync(path.join(projectDir, "node_modules", ".package-lock.json"));
    if (dependencyFilesChanged || dependencyDirMissing) {
      // 只有依赖清单变化或 node_modules 不完整时重装，避免每次同步都长时间 npm ci。
      await runCommand("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], projectDir, 300_000, env);
    }
    // 构建需要读取站点数据生成 sitemap/metadata，但不应迁移、清理或写入正式库。
    // 运行时重启不继承这个临时标记，正式服务仍使用可写数据库。
    const buildEnv = {
      ...env,
      BLOG_BUILD_READONLY: "true",
      BLOG_DB_PATH: databasePath,
      BLOG_ROOT: projectDir,
    };
    await runCommand("npm", ["run", "build"], projectDir, 300_000, buildEnv);
    const processName = await findPm2Name(projectDir);
    if (!processName) return { ok: false, error: "代码同步并构建成功，但没有找到对应的 PM2 进程" };
    schedulePm2Restart(projectDir, processName);

    const changed = before.stdout.trim() !== after.stdout.trim();
    return {
      ok: true,
      message: changed ? "GitHub 代码已更新，数据库已备份，构建完成，已交给 PM2 重启。" : "代码已经是最新版本，数据库已备份，构建完成，已交给 PM2 重启。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步或部署异常";
    return { ok: false, error: `同步失败：${message}` };
  } finally {
    releaseLock?.();
  }
}

/** 查询 detached PM2 重启脚本写入的最终状态，供设置页确认重启是否完成。 */
export async function getGithubDeployStatusAction(): Promise<GithubDeployStatus> {
  await requireAdmin();
  const projectDir = deploymentProjectDir();
  const statusFile = path.join(projectDir, "data", "deploy-status.json");
  try {
    const value = JSON.parse(fs.readFileSync(statusFile, "utf8")) as Partial<GithubDeployStatus>;
    if (value.status === "restarting" || value.status === "success" || value.status === "failed") {
      return { status: value.status, updatedAt: value.updatedAt, error: value.error };
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
