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

// Next standalone 不会自动把静态资源复制到 standalone 目录；本地启动前补齐，
// 否则 HTML 能打开但 CSS、图片和 favicon 会返回 404。
const standaloneRoot = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneRoot, "public");
if (fs.existsSync(staticSource)) fs.cpSync(staticSource, staticTarget, { recursive: true, force: true });
if (fs.existsSync(publicSource)) fs.cpSync(publicSource, publicTarget, { recursive: true, force: true });

await import("../.next/standalone/server.js");
