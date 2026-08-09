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
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) {
    // turbopackIgnore：该路径是运行时的 env 配置，不参与构建期文件追踪
    return path.resolve(/* turbopackIgnore: true */ configured);
  }
  return path.join(getProjectRoot(), "data", "uploads");
}

/** 所有兼容的上传目录，按持久化目录、旧目录、standalone 静态目录优先级排列。 */
export function getUploadRoots(): string[] {
  const projectRoot = getProjectRoot();
  return [...new Set([
    getUploadDir(),
    path.join(projectRoot, "public", "uploads"),
    path.join(projectRoot, ".next", "standalone", "public", "uploads"),
    path.join(process.cwd(), "data", "uploads"),
    path.join(process.cwd(), "public", "uploads"),
  ].map((root) => path.resolve(root)))];
}

/** 把 `/uploads/...` 相对路径解析为磁盘绝对路径，越界（如路径穿越）返回 null。 */
export function uploadAbsolutePath(relativePath: string): string | null {
  const clean = relativePath.trim();
  if (!clean.startsWith("/uploads/")) return null;
  const relative = clean.replace(/^\/uploads\//, "");
  const roots = getUploadRoots();
  let fallback: string | null = null;
  for (const root of roots) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) return null;
    fallback ??= target;
    // 兼容统一目录切换前写入 public/uploads 的旧文件。
    if (fs.existsSync(target)) return target;
  }
  return fallback;
}
