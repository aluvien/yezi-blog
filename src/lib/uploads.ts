import fs from "fs";
import path from "path";

/**
 * 推断项目根目录，避免 standalone 服务直接启动时 process.cwd() 落在 .next/standalone。
 * 生产环境通常由 start-standalone.mjs 注入 BLOG_ROOT；这里保留无环境变量时的兜底。
 */
export function getProjectRoot(): string {
  const configured = process.env.BLOG_ROOT?.trim();
  if (configured) return path.resolve(configured);

  const configuredDb = process.env.BLOG_DB_PATH?.trim();
  if (configuredDb) {
    const dbDirectory = path.dirname(path.resolve(configuredDb));
    return path.basename(dbDirectory) === "data" ? path.dirname(dbDirectory) : dbDirectory;
  }

  let current = path.resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    // Next standalone 自带 package.json，必须先识别它，不能把 .next/standalone 当成项目根。
    if (path.basename(current) === "standalone" && path.basename(path.dirname(current)) === ".next") {
      return path.dirname(path.dirname(current));
    }
    if (fs.existsSync(path.join(current, "data", "blog.db")) || fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(process.cwd());
}

/**
 * 上传文件根目录的统一入口。
 * standalone 生产模式（start-standalone.mjs）会把上传目录切到项目根 data/uploads，
 * 因此上传、读取、裁切、删除必须走同一个目录解析，不能各自硬编码某个运行目录。
 */
export function getUploadDir(): string {
  // 附件唯一落盘位置：项目根目录 data/uploads。
  // 不读取 UPLOAD_DIR，避免不同进程配置不同目录后出现数据分叉。
  return path.join(getProjectRoot(), "data", "uploads");
}

/** 把 `/uploads/...` 相对路径解析为磁盘绝对路径，越界（如路径穿越）返回 null。 */
export function uploadAbsolutePath(relativePath: string): string | null {
  let clean = relativePath.trim().split(/[?#]/, 1)[0];
  try {
    if (/^https?:\/\//i.test(clean)) clean = new URL(clean).pathname;
    clean = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (clean.startsWith("uploads/")) clean = `/${clean}`;
  if (!clean.startsWith("/uploads/")) return null;
  const relative = clean.replace(/^\/uploads\//, "");
  const root = getUploadDir();
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}
