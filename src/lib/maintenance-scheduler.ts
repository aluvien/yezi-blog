import { cleanupExpiredAuthState } from "@/lib/db/session-auth";
import { deleteExpiredViewInteractions } from "@/lib/db/metrics";
import { tryAcquireMaintenanceLease } from "@/lib/db/maintenance";

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type SchedulerGlobal = typeof globalThis & { __yeziMaintenanceTimer?: ReturnType<typeof setInterval> };

export function runScheduledMaintenance(referenceTime = Date.now()): boolean {
  if (!tryAcquireMaintenanceLease("transient-data-cleanup", referenceTime, MAINTENANCE_INTERVAL_MS)) return false;
  cleanupExpiredAuthState(referenceTime);
  deleteExpiredViewInteractions(referenceTime);
  return true;
}

export function startMaintenanceScheduler(): void {
  const state = globalThis as SchedulerGlobal;
  if (state.__yeziMaintenanceTimer) return;
  try {
    runScheduledMaintenance();
  } catch (error) {
    console.warn("[maintenance] startup cleanup failed", error instanceof Error ? error.message : error);
  }
  state.__yeziMaintenanceTimer = setInterval(() => {
    try {
      runScheduledMaintenance();
    } catch (error) {
      console.warn("[maintenance] scheduled cleanup failed", error instanceof Error ? error.message : error);
    }
  }, MAINTENANCE_INTERVAL_MS);
  state.__yeziMaintenanceTimer.unref?.();
}
