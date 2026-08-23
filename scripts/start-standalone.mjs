import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.trim();
    process.env[key] =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
}

function restrictFilePermissions(filePath) {
  if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
}

// 不能依赖 PM2 的 exec cwd：旧进程可能把 cwd 留在 .next/standalone，
// 这样会让相对数据库、上传目录和环境文件指向错误位置。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (!process.env.BLOG_ROOT) process.env.BLOG_ROOT = root;
const localEnv = path.join(root, ".env.local");
const fallbackEnv = path.join(root, ".env");
restrictFilePermissions(localEnv);
restrictFilePermissions(fallbackEnv);
loadEnvFile(localEnv);
loadEnvFile(fallbackEnv);
if (!process.env.PORT) process.env.PORT = "3030";
if (!process.env.HOSTNAME) process.env.HOSTNAME = "0.0.0.0";

// standalone server 启动后可能把 cwd 切到 .next/standalone，数据库必须固定在项目根目录，
// 否则本地数据和运行中的网站会各自使用一份 blog.db。
if (!process.env.BLOG_DB_PATH) process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
// 上传文件只存到项目根 data/uploads（与 blog.db 同目录持久化），由 /uploads route 实时提供。
// 不写入 public 或 standalone，避免多个目录造成数据分叉。
const dataDir = path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDir, 0o700);
fs.chmodSync(uploadDir, 0o700);

// 维护只在真正启动服务时执行，避免 next build 加载数据库模块时修改生产数据。
await import("./maintain-db.mjs");

// Next standalone 不会自动把静态资源复制到 standalone 目录；本地启动前补齐，
// 否则 HTML 能打开但 CSS、图片和 favicon 会返回 404。
const standaloneRoot = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneRoot, "public");

function sourceSignature(source) {
  const hash = crypto.createHash("sha256");
  function visit(directory, relativeDirectory = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      const stat = fs.statSync(absolute);
      hash.update(`${relative}\0${stat.size}\0${stat.mtimeMs}\n`);
    }
  }
  visit(source);
  return hash.digest("hex");
}

function copyIfChanged(source, target) {
  if (!fs.existsSync(source)) return;
  const marker = `${target}.copy-marker`;
  const signature = sourceSignature(source);
  let previous = "";
  try {
    previous = fs.readFileSync(marker, "utf8");
  } catch {
    // 首次启动或旧部署没有标记，需要复制。
  }
  if (previous === signature && fs.existsSync(target)) return;
  fs.cpSync(source, target, { recursive: true, force: true });
  fs.writeFileSync(marker, signature, { mode: 0o600 });
}

// standalone 不会携带 .next/static；缺失时 HTML 仍可服务，但所有 Client Component
// 都不会水合，表现为“后台按钮全部点不动”。静态资源是构建产物，启动前直接完整
// 替换，避免旧 marker 或半完成复制让新 HTML 指向不存在的 chunk。
function copyStaticAssets() {
  if (!fs.existsSync(staticSource)) throw new Error(`未找到 Next 静态资源目录：${staticSource}`);
  const nonce = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const staging = `${staticTarget}.staging-${nonce}`;
  const previous = `${staticTarget}.previous-${nonce}`;
  let movedPrevious = false;
  try {
    // 先在同一文件系统完整复制并校验，旧资源在此期间继续可用。直接先删旧目录
    // 会在复制中断时造成 HTML 正常、CSS/客户端脚本全部 404 的半部署状态。
    fs.cpSync(staticSource, staging, { recursive: true, force: true });
    const chunks = path.join(staging, "chunks");
    if (!fs.existsSync(chunks) || fs.readdirSync(chunks).length === 0) {
      throw new Error(`Next 静态资源校验失败：${staging}`);
    }
    fs.mkdirSync(path.dirname(staticTarget), { recursive: true });
    if (fs.existsSync(staticTarget)) {
      fs.renameSync(staticTarget, previous);
      movedPrevious = true;
    }
    fs.renameSync(staging, staticTarget);
    if (movedPrevious) fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious && !fs.existsSync(staticTarget) && fs.existsSync(previous)) {
      fs.renameSync(previous, staticTarget);
    }
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    // 成功路径会删除，异常且已恢复时也清理；若恢复失败则保留 previous 供人工救援。
    if (fs.existsSync(staticTarget)) fs.rmSync(previous, { recursive: true, force: true });
  }
}

copyStaticAssets();
copyIfChanged(publicSource, publicTarget);

// 不在包装脚本里 process.exit：Next standalone server 会接管 SIGTERM/SIGINT，
// 让 in-flight 请求和 after() 任务拥有自己的优雅退出窗口。
await import("../.next/standalone/server.js");
