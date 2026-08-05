import path from "path";

/**
 * 上传文件根目录的统一入口。
 * standalone 生产模式（start-standalone.mjs）会把上传目录切到项目根 data/uploads，
 * 因此上传、读取、裁切、删除必须走同一个目录解析，不能各自硬编码 public/uploads。
 */
export function getUploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) {
    // turbopackIgnore：该路径是运行时的 env 配置，不参与构建期文件追踪
    return path.resolve(/* turbopackIgnore: true */ configured);
  }
  return path.join(process.cwd(), "public", "uploads");
}

/** 把 `/uploads/...` 相对路径解析为磁盘绝对路径，越界（如路径穿越）返回 null。 */
export function uploadAbsolutePath(relativePath: string): string | null {
  const clean = relativePath.trim();
  if (!clean.startsWith("/uploads/")) return null;
  const root = getUploadDir();
  const target = path.resolve(root, clean.replace(/^\/uploads\//, ""));
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}
