import { uploadAbsolutePath } from "@/lib/uploads";

/** 将 iOS 提交的 uploads 相对路径收敛为内部 /uploads/... 路径，并拒绝任何路径穿越。 */
export function parseUntrackedUploadPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replaceAll("\\", "/");
  if (!raw || raw.length > 2_000 || raw.includes("\0") || raw.includes("?") || raw.includes("#")) return null;
  if (raw.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  const webPath = raw.startsWith("/uploads/")
    ? raw
    : raw.startsWith("uploads/")
      ? `/${raw}`
      : raw.startsWith("/")
        ? ""
        : `/uploads/${raw}`;
  return webPath && uploadAbsolutePath(webPath) ? webPath : null;
}
