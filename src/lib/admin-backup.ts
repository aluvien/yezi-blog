import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { runDbBackup } from "@/lib/backup";
import { verifyDatabaseBackup } from "@/lib/backup-verification";
import { getProjectRoot } from "@/lib/uploads";
import type { AdminBackupPhase, AdminBackupStatus } from "@/lib/admin-backup-types";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const runtime = globalThis as typeof globalThis & { yeziBackupBootId?: string };
runtime.yeziBackupBootId ??= crypto.randomUUID();
const CONFIG_NAMES = [
  ".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local",
  "ecosystem.config.js", "ecosystem.config.cjs", "ecosystem.config.mjs", "ecosystem.config.json",
  "next.config.ts", "next.config.js", "next.config.mjs", "package.json", "package-lock.json",
];
// Preserve app overrides supplied by PM2 without exporting the entire host environment.
const ENV_NAMES = [
  "ADMIN_PASSWORD", "ADMIN_API_TOKEN", "NEXT_PUBLIC_SITE_URL", "SERVER_ACTION_ALLOWED_ORIGINS", "API_CORS_ORIGIN",
  "TRUST_PROXY", "SESSION_COOKIE_SECURE", "BLOG_ROOT", "BLOG_DB_PATH", "BLOG_BACKUP_DIR", "BLOG_ENV_FILE",
  "BACKUP_KEEP", "DATA_BACKUP_KEY", "DATA_BACKUP_KEEP", "DATA_BACKUP_MIRROR_DIR", "PM2_HOME", "PORT", "HOSTNAME", "NODE_ENV",
  "DEPLOY_PROJECT_DIR", "DEPLOY_PM2_NAME", "DEPLOY_PM2_BIN", "DEPLOY_RESTART_MODE", "DEPLOY_DIRECT_HTTP",
  "DEPLOY_RELEASES_DIR", "DEPLOY_CURRENT_LINK", "QQ_MUSIC_API_URL", "QQ_MUSIC_API_PORT", "QQ_MUSIC_SESSION_PATH",
  "QQ_MUSIC_SIGNING_KEY", "QQ_MUSIC_AUDIO_CACHE_ENABLED", "QQ_MUSIC_HEALTH_CHECK_MID", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_USER_ID", "GITHUB_TOKEN", "LLM_API_KEY", "LLM_API_URL", "LLM_MODEL", "OPENAI_API_KEY",
];
const RESTORE_GUIDE = `# 叶子博客完整数据备份

此包未加密，包含密码、API 密钥、QQ Cookie 和私有内容。请保存到受保护的位置，不要上传公开仓库。

## 内容
- data/blog.db：经过完整性校验的 SQLite 在线快照（包括 WAL 中已提交的数据）。
- data/：上传图片、附件、引用归档、站点运行状态等持久化文件。
- config/project/ 与 config/state-root/：找到的原环境文件、PM2/Next 配置、依赖版本文件。
- config/external.env：若设置 BLOG_ENV_FILE，保存该文件原文。
- config/runtime.env：应用实际使用的环境变量（可能由 PM2 注入）。
- manifest.json：版本、原始配置位置、文件大小和 SHA-256 校验值。

## 恢复
1. 将压缩包解到独立的私有目录，先查看 manifest.json，不要直接覆盖正在运行的网站。
2. 使用 manifest 中的 sourceCommit 对应源码安装依赖；停下博客进程后再恢复数据。
3. 为现有数据和配置另做一份备份，将 data/ 的内容复制到新项目的 data/。清除目标旧的 blog.db-wal、blog.db-shm 后恢复 blog.db。
4. 如 BLOG_DB_PATH 或 QQ_MUSIC_SESSION_PATH 指向其他位置，按 manifest.locations 将相应文件放回该位置，或修改配置使用新位置。
5. 恢复相应环境文件和 PM2 配置。对照 runtime.env 合并由 PM2 注入的值；迁移机器时必须调整 BLOG_ROOT、BLOG_DB_PATH、BLOG_ENV_FILE、DEPLOY_PROJECT_DIR、PM2_HOME 等绝对路径。不要不加检查地直接 source runtime.env。
6. 环境文件权限设为 0600，数据目录归网站运行用户所有。构建并按现有方式启动，验证文章、图片、后台登录后再开放访问。

文件复制与数据库快照不是整个文件系统的原子快照。备份期间请避免删除附件或修改配置；可继续浏览网站。
不包含历史备份、临时文件、可再生成的 QQ 音频缓存、依赖和构建产物。服务器 Nginx、证书和系统级 PM2 配置不在应用备份范围内。
`;

type Lock = { id: string; pid: number; bootId: string };
type FileEntry = { path: string; sizeBytes: number; sha256: string };
type Manifest = {
  format: number;
  createdAt: string;
  sourceCommit: string | null;
  schemaVersion: number;
  locations: Record<string, string>;
  configuration: Array<{ file: string; originalPath: string }>;
  excludes: string[];
  files: FileEntry[];
};

function backupDirectory(): string {
  return path.join(getProjectRoot(), "data", "backups", "admin");
}
function prepareDirectory(): string {
  const root = backupDirectory();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  return root;
}
function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}
function writeStatus(root: string, status: AdminBackupStatus): void {
  const temporary = path.join(root, `.status-${status.id}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(status)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, path.join(root, "status.json"));
}
function lockIsAlive(lock: Lock | null): boolean {
  if (!lock || !Number.isSafeInteger(lock.pid) || lock.pid <= 0 || !ID_PATTERN.test(lock.id)) return false;
  if (lock.pid === process.pid) return lock.bootId === runtime.yeziBackupBootId;
  try { process.kill(lock.pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function reconcileInterrupted(root: string): void {
  const lockPath = path.join(root, ".lock");
  if (!fs.existsSync(lockPath)) {
    const status = readJson<AdminBackupStatus>(path.join(root, "status.json"));
    if (status?.status === "running") writeStatus(root, { ...status, status: "failed", updatedAt: new Date().toISOString(), error: "备份任务已中断，请重新备份。" });
    return;
  }
  const lock = readJson<Lock>(lockPath);
  // Another process may still be writing a newly created lock. Never remove it in that window.
  if (!lock && Date.now() - fs.statSync(lockPath).mtimeMs < 60_000) return;
  if (lockIsAlive(lock)) return;
  const status = readJson<AdminBackupStatus>(path.join(root, "status.json"));
  if (status?.status === "running") {
    writeStatus(root, { ...status, status: "failed", updatedAt: new Date().toISOString(), error: "网站进程重启，备份已中断，请重新备份。" });
  }
  // Only paths derived from validated, server-generated UUIDs may be removed.
  if (lock && ID_PATTERN.test(lock.id)) {
    fs.rmSync(path.join(root, `.stage-${lock.id}`), { recursive: true, force: true });
    fs.rmSync(path.join(root, `${lock.id}.tar.gz.tmp`), { force: true });
  }
  fs.rmSync(lockPath, { force: true });
}

export function getAdminBackupStatus(): AdminBackupStatus | null {
  const root = backupDirectory();
  reconcileInterrupted(root);
  return readJson<AdminBackupStatus>(path.join(root, "status.json"));
}

export function startAdminBackup(): { status: AdminBackupStatus; started: boolean } {
  const root = prepareDirectory();
  reconcileInterrupted(root);
  const id = crypto.randomUUID();
  let fd: number;
  try { fd = fs.openSync(path.join(root, ".lock"), "wx", 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const status = getAdminBackupStatus();
    if (status?.status === "running") return { status, started: false };
    throw new Error("备份锁不可用");
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ id, pid: process.pid, bootId: runtime.yeziBackupBootId }));
    const now = new Date().toISOString();
    const status: AdminBackupStatus = { id, status: "running", phase: "database", createdAt: now, updatedAt: now };
    writeStatus(root, status);
    return { status, started: true };
  } catch (error) {
    fs.rmSync(path.join(root, ".lock"), { force: true });
    throw error;
  } finally { fs.closeSync(fd); }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), new Writable({ write(chunk, _encoding, done) { hash.update(chunk); done(); } }));
  return hash.digest("hex");
}
async function listFiles(root: string, directory = root): Promise<FileEntry[]> {
  const result: FileEntry[] = [];
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, file));
    else if (entry.isFile()) result.push({ path: path.relative(root, file).split(path.sep).join("/"), sizeBytes: (await fs.promises.stat(file)).size, sha256: await hashFile(file) });
    else throw new Error("备份包含不支持的文件类型");
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function copyData(source: string, target: string, dataRoot: string, ancestors: string[] = [], excluded: string[] = []): Promise<void> {
  const relative = path.relative(dataRoot, source);
  if (excluded.includes(path.resolve(source))) return;
  if (relative && (["backups", "qq-music-audio"].includes(relative.split(path.sep)[0]) || /\.tmp$/.test(relative) || excluded.includes(path.resolve(source)) || /(?:^|\/)blog\.db(?:-wal|-shm)?$/.test(relative))) return;
  const real = await fs.promises.realpath(source);
  if (real !== dataRoot && !real.startsWith(`${dataRoot}${path.sep}`)) throw new Error("数据软链接指向备份范围外");
  const stat = await fs.promises.stat(source);
  if (stat.isDirectory()) {
    if (ancestors.includes(real)) throw new Error("数据目录包含循环软链接");
    await fs.promises.mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of await fs.promises.readdir(source)) await copyData(path.join(source, name), path.join(target, name), dataRoot, [...ancestors, real], excluded);
  } else if (stat.isFile()) {
    await fs.promises.copyFile(source, target);
    await fs.promises.chmod(target, 0o600);
  } else throw new Error("数据目录包含不支持的文件类型");
}

async function sourceCommit(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    const git = spawn("git", ["rev-parse", "HEAD"], { cwd: process.env.DEPLOY_PROJECT_DIR?.trim() || root, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    git.stdout.on("data", (chunk) => { output += chunk.toString(); });
    git.once("error", () => resolve(null));
    git.once("close", (code) => resolve(code === 0 && /^[a-f0-9]{40}$/.test(output.trim()) ? output.trim() : null));
  });
}

async function copyConfiguration(stage: string, root: string): Promise<Manifest["configuration"]> {
  const config = path.join(stage, "config");
  await fs.promises.mkdir(config, { recursive: true, mode: 0o700 });
  const sources: Manifest["configuration"] = [];
  const copy = async (source: string, relative: string, required = false) => {
    if (!fs.existsSync(source)) {
      if (required) throw new Error("已配置的环境文件不存在");
      return;
    }
    if (!(await fs.promises.stat(source)).isFile()) throw new Error("配置文件不可读取");
    const target = path.join(stage, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.promises.copyFile(source, target);
    await fs.promises.chmod(target, 0o600);
    sources.push({ file: relative, originalPath: source });
  };
  const project = path.resolve(process.env.DEPLOY_PROJECT_DIR?.trim() || root);
  for (const name of CONFIG_NAMES) await copy(path.join(project, name), `config/project/${name}`);
  if (project !== root) for (const name of CONFIG_NAMES) await copy(path.join(root, name), `config/state-root/${name}`);
  const external = process.env.BLOG_ENV_FILE?.trim();
  if (external) await copy(path.resolve(external), "config/external.env", true);
  const environment = ENV_NAMES.filter((name) => process.env[name] !== undefined).map((name) => `${name}=${JSON.stringify(process.env[name])}`).join("\n");
  await fs.promises.writeFile(path.join(config, "runtime.env"), `${environment}\n`, { mode: 0o600 });
  return sources;
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("归档处理失败")));
  });
}

/** Verifies only a server-created archive; never accepts user-uploaded archives. */
export async function verifyAdminBackupArchive(archive: string, extractRoot: string): Promise<{ files: number; schemaVersion: number }> {
  await runTar(["-xzf", archive, "-C", extractRoot]);
  const manifest = readJson<Manifest>(path.join(extractRoot, "manifest.json"));
  if (manifest?.format !== 1 || !Array.isArray(manifest.files)) throw new Error("备份清单无效");
  const files = (await listFiles(extractRoot)).filter((file) => file.path !== "manifest.json");
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error("备份文件校验失败");
  const verified = verifyDatabaseBackup(path.join(extractRoot, "data", "blog.db"));
  if (verified.schemaVersion !== manifest.schemaVersion || !files.some((file) => file.path === "config/runtime.env")) throw new Error("备份配置校验失败");
  return { files: files.length, schemaVersion: verified.schemaVersion };
}

export async function executeAdminBackup(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const root = backupDirectory();
  const lock = readJson<Lock>(path.join(root, ".lock"));
  const initial = readJson<AdminBackupStatus>(path.join(root, "status.json"));
  if (lock?.id !== id || lock.pid !== process.pid || lock.bootId !== runtime.yeziBackupBootId || initial?.id !== id || initial.status !== "running") return;
  const stage = path.join(root, `.stage-${id}`);
  const temporary = path.join(root, `${id}.tar.gz.tmp`);
  const destination = path.join(root, `${id}.tar.gz`);
  let phase: AdminBackupPhase = "database";
  const progress = (next: AdminBackupPhase) => {
    phase = next;
    writeStatus(root, { ...initial, phase, updatedAt: new Date().toISOString() });
  };
  try {
    await fs.promises.mkdir(stage, { mode: 0o700 });
    const snapshot = await runDbBackup({ backupDir: path.join(stage, ".database") });
    const stateRoot = getProjectRoot();
    const dataRoot = await fs.promises.realpath(path.join(stateRoot, "data"));
    const dbPath = await fs.promises.realpath(path.resolve(process.env.BLOG_DB_PATH?.trim() || path.join(stateRoot, "data", "blog.db")));
    const snapshotDirectory = await fs.promises.realpath(path.dirname(snapshot.path));
    progress("files");
    await copyData(dataRoot, path.join(stage, "data"), dataRoot, [], [snapshotDirectory, dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
    await fs.promises.copyFile(snapshot.path, path.join(stage, "data", "blog.db"));
    await fs.promises.chmod(path.join(stage, "data", "blog.db"), 0o600);
    await fs.promises.rm(path.dirname(snapshot.path), { recursive: true, force: true });
    // These stores follow BLOG_DB_PATH or a separately configured session path.
    const sessionPath = path.resolve(process.env.QQ_MUSIC_SESSION_PATH?.trim() || path.join(path.dirname(dbPath), "qq-music-session.json"));
    const telegramPath = path.join(path.dirname(dbPath), "telegram-bot-state.json");
    for (const [source, name] of [[sessionPath, "qq-music-session.json"], [telegramPath, "telegram-bot-state.json"]]) {
      if (fs.existsSync(source)) {
        await fs.promises.copyFile(source, path.join(stage, "data", name));
        await fs.promises.chmod(path.join(stage, "data", name), 0o600);
      }
    }
    progress("config");
    const configuration = await copyConfiguration(stage, stateRoot);
    await fs.promises.writeFile(path.join(stage, "RESTORE.md"), RESTORE_GUIDE, { mode: 0o600 });
    const commit = fs.existsSync(path.join(stateRoot, "data", "deploy-commit")) ? fs.readFileSync(path.join(stateRoot, "data", "deploy-commit"), "utf8").trim() : "";
    const manifest: Manifest = {
      format: 1, createdAt: initial.createdAt,
      sourceCommit: await sourceCommit(stateRoot) || (/^[a-f0-9]{40}$/.test(process.env.DEPLOY_BUILD_COMMIT || commit) ? (process.env.DEPLOY_BUILD_COMMIT || commit) : null),
      schemaVersion: snapshot.verification.schemaVersion,
      locations: { BLOG_ROOT: stateRoot, BLOG_DB_PATH: dbPath, QQ_MUSIC_SESSION_PATH: sessionPath, TELEGRAM_STATE_PATH: telegramPath },
      configuration,
      excludes: ["data/backups", "data/qq-music-audio", "SQLite WAL/SHM", "*.tmp", "node_modules", ".next"],
      files: await listFiles(stage),
    };
    await fs.promises.writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    progress("archive");
    // Pre-create with restrictive permissions before tar writes any secrets.
    await fs.promises.writeFile(temporary, "", { mode: 0o600 });
    await runTar(["-czf", temporary, "-C", stage, "manifest.json", "RESTORE.md", "data", "config"]);
    progress("verify");
    const verifiedRoot = path.join(stage, ".verification");
    await fs.promises.mkdir(verifiedRoot, { mode: 0o700 });
    const verified = await verifyAdminBackupArchive(temporary, verifiedRoot);
    await fs.promises.rename(temporary, destination);
    const sizeBytes = (await fs.promises.stat(destination)).size;
    writeStatus(root, { ...initial, status: "completed", phase: "complete", updatedAt: new Date().toISOString(), sizeBytes, fileCount: verified.files });
    const archives = (await fs.promises.readdir(root)).filter((name) => ID_PATTERN.test(name.replace(/\.tar\.gz$/, "")) && name.endsWith(".tar.gz"));
    const sorted = await Promise.all(archives.map(async (name) => ({ name, time: (await fs.promises.stat(path.join(root, name))).mtimeMs })));
    for (const entry of sorted.sort((a, b) => b.time - a.time).slice(3)) await fs.promises.rm(path.join(root, entry.name), { force: true });
  } catch (error) {
    console.error("[admin-backup] failed", phase, error instanceof Error ? error.name : "unknown", (error as NodeJS.ErrnoException)?.code ?? "unknown");
    await fs.promises.rm(destination, { force: true });
    writeStatus(root, { ...initial, status: "failed", phase, updatedAt: new Date().toISOString(), error: "备份未完成，请检查磁盘空间、数据和配置文件读取权限，以及 tar 是否可用后重试。" });
  } finally {
    await fs.promises.rm(stage, { recursive: true, force: true });
    await fs.promises.rm(temporary, { force: true });
    const currentLock = readJson<Lock>(path.join(root, ".lock"));
    if (currentLock?.id === id) await fs.promises.rm(path.join(root, ".lock"), { force: true });
  }
}

export function getAdminBackupDownload(id: string): { path: string; name: string; size: number } | null {
  if (!ID_PATTERN.test(id)) return null;
  const status = getAdminBackupStatus();
  if (status?.id !== id || status.status !== "completed") return null;
  const file = path.join(backupDirectory(), `${id}.tar.gz`);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return null;
    return { path: file, name: `yezi-backup-${status.createdAt.replace(/[:.]/g, "-")}.tar.gz`, size: stat.size };
  } catch { return null; }
}
