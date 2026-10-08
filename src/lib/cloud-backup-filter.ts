import type { CloudBackupFile, CloudBackupSettings } from "@/lib/cloud-backup-types";

/** The default list matches the full current host, never its parent or historical hosts. */
export function isCurrentSiteBackup(
  file: Pick<CloudBackupFile, "site" | "siteId">,
  identity: Pick<CloudBackupSettings, "siteLabel" | "siteId">,
): boolean {
  return Boolean(identity.siteLabel && file.site === identity.siteLabel && (!file.siteId || file.siteId === identity.siteId));
}
