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
