import crypto from "node:crypto";
import { db } from "@/lib/db/core";
import { getSiteSettings, setSiteSettings } from "@/lib/db/settings";
import { normalizeSiteUrl } from "@/lib/site-url";
import { cloudBackupSiteLabel } from "@/lib/cloud-backup-name";
export { isCurrentSiteBackup } from "@/lib/cloud-backup-filter";

/** Runtime database setting wins over the installation fallback. Never inline NEXT_PUBLIC here. */
export function getSiteUrl(settings = getSiteSettings()): string {
  const env = process.env;
  for (const value of [settings.site_url, env.NEXT_PUBLIC_SITE_URL]) {
    try { const origin = normalizeSiteUrl(value || ""); if (origin) return origin; } catch { /* Old installation configuration may be invalid. */ }
  }
  return "http://localhost:3030";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type BackupSiteIdentity = { siteId: string; siteLabel: string; siteLabels: string[] };

/** Persist with the database so the identity follows a full recovery or server migration. */
export function getBackupSiteIdentity(): BackupSiteIdentity {
  return db.transaction(() => {
    const settings = getSiteSettings();
    const siteId = UUID.test(settings.backup_site_id || "") ? settings.backup_site_id : crypto.randomUUID();
    const siteLabel = cloudBackupSiteLabel(getSiteUrl(settings));
    let labels: unknown;
    try { labels = JSON.parse(settings.backup_site_labels || "[]"); } catch { labels = []; }
    const siteLabels = [...new Set([...(Array.isArray(labels) ? labels.filter((label): label is string => typeof label === "string" && /^[a-z0-9][a-z0-9.-]{0,99}$/.test(label)) : []), siteLabel])];
    const encoded = JSON.stringify(siteLabels);
    if (settings.backup_site_id !== siteId || settings.backup_site_labels !== encoded) {
      setSiteSettings({ backup_site_id: siteId, backup_site_labels: encoded });
    }
    return { siteId, siteLabel, siteLabels };
  })();
}
