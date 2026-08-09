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

// 不能依赖 PM2 的 exec cwd：旧进程可能把 cwd 留在 .next/standalone，
// 这样会让相对数据库、上传目录和环境文件指向错误位置。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (!process.env.BLOG_ROOT) process.env.BLOG_ROOT = root;
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

// standalone server 启动后可能把 cwd 切到 .next/standalone，数据库必须固定在项目根目录，
// 否则本地数据和运行中的网站会各自使用一份 blog.db。
if (!process.env.BLOG_DB_PATH) process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
// 上传文件存到项目根 data/uploads（与 blog.db 同目录持久化），由 /uploads route 实时提供。
// 避免写入 standalone/public 后新文件不被静态服务识别（需重启才出现的 404 问题）。
if (!process.env.UPLOAD_DIR) process.env.UPLOAD_DIR = path.join(root, "data", "uploads");
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

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

copyIfChanged(staticSource, staticTarget);
copyIfChanged(publicSource, publicTarget);

// PM2 重启或容器停止时尽快退出。standalone server.js 不暴露 http 句柄，
// 无法优雅 drain in-flight 请求；如需真正优雅退出需改用自定义 server。
function shutdown(signal) {
  console.log(`收到 ${signal}，正在退出…`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await import("../.next/standalone/server.js");
