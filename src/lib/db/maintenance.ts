import { db } from "./core";

/**
 * Acquire a database-backed low-frequency lease. Multiple PM2/container
 * instances may call this concurrently; only one receives true per interval.
 */
export function tryAcquireMaintenanceLease(name: string, referenceTime: number, intervalMs: number): boolean {
  const safeName = name.trim().slice(0, 80);
  if (!safeName || !Number.isFinite(referenceTime) || !Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  return db.transaction(() => {
    const row = db.prepare("SELECT last_run_at FROM maintenance_leases WHERE name = ?").get(safeName) as { last_run_at: number } | undefined;
    if (row && referenceTime - row.last_run_at < intervalMs) return false;
    db.prepare(`
      INSERT INTO maintenance_leases (name, last_run_at) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at
    `).run(safeName, referenceTime);
    return true;
  })();
}
