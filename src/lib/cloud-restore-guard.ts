import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "@/lib/uploads";
export function cloudRestoreGuardPath(): string {
  return path.join(getProjectRoot(), "data", "backups", "cloud", ".restore-hold");
}
export function isCloudRestoreActive(): boolean { return fs.existsSync(cloudRestoreGuardPath()); }

export function currentDataEpoch(): string {
  try { return fs.readFileSync(path.join(path.dirname(cloudRestoreGuardPath()), "restore-epoch"), "utf8"); } catch { return ""; }
}

/** Recheck after awaited work, immediately before a synchronous data write. */
export function dataWriteRejection(epoch: string): string | null {
  return isCloudRestoreActive() || currentDataEpoch() !== epoch
    ? "网站数据已进入恢复流程，本次保存已取消。请刷新页面后重新编辑。"
    : null;
}
