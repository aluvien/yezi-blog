import crypto from "node:crypto";
import os from "node:os";

/** Stable, filename-safe site identity; never includes credentials or URL paths. */
export function cloudBackupSiteLabel(source = process.env.NEXT_PUBLIC_SITE_URL, fallback = os.hostname()): string {
  let host = fallback;
  if (source) {
    try {
      const url = new URL(source);
      if (["http:", "https:"].includes(url.protocol)) host = `${url.hostname}${url.port ? `-${url.port}` : ""}`;
    } catch { /* An unset or invalid public URL uses the machine hostname. */ }
  }
  const label = host.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "unknown-host";
  return label.length <= 100 ? label : `${label.slice(0, 87)}-${crypto.createHash("sha256").update(label).digest("hex").slice(0, 12)}`;
}
