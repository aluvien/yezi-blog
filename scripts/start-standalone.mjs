import fs from "node:fs";
import path from "node:path";

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

const root = process.cwd();
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

// standalone server 启动后可能把 cwd 切到 .next/standalone，数据库必须固定在项目根目录，
// 否则本地数据和运行中的网站会各自使用一份 blog.db。
if (!process.env.BLOG_DB_PATH) process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
// 上传文件存到项目根 data/uploads（与 blog.db 同目录持久化），由 /uploads route 实时提供。
// 避免写入 standalone/public 后新文件不被静态服务识别（需重启才出现的 404 问题）。
if (!process.env.UPLOAD_DIR) process.env.UPLOAD_DIR = path.join(root, "data", "uploads");
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

// Next standalone 不会自动把静态资源复制到 standalone 目录；本地启动前补齐，
// 否则 HTML 能打开但 CSS、图片和 favicon 会返回 404。
const standaloneRoot = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneRoot, "public");
if (fs.existsSync(staticSource)) fs.cpSync(staticSource, staticTarget, { recursive: true, force: true });
if (fs.existsSync(publicSource)) fs.cpSync(publicSource, publicTarget, { recursive: true, force: true });

// PM2 重启或容器停止时尽快退出。standalone server.js 不暴露 http 句柄，
// 无法优雅 drain in-flight 请求；如需真正优雅退出需改用自定义 server。
function shutdown(signal) {
  console.log(`收到 ${signal}，正在退出…`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await import("../.next/standalone/server.js");
