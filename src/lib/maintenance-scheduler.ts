import { cleanupExpiredAuthState } from "@/lib/db/session-auth";
import { deleteExpiredViewInteractions } from "@/lib/db/metrics";
import { tryAcquireMaintenanceLease } from "@/lib/db/maintenance";
import { pruneQQMusicAudioCache } from "@/lib/qq-music-audio-cache";

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type SchedulerGlobal = typeof globalThis & { __yeziMaintenanceTimer?: ReturnType<typeof setInterval> };

export function runScheduledMaintenance(referenceTime = Date.now()): boolean {
  if (!tryAcquireMaintenanceLease("transient-data-cleanup", referenceTime, MAINTENANCE_INTERVAL_MS)) return false;
  cleanupExpiredAuthState(referenceTime);
  deleteExpiredViewInteractions(referenceTime);
  // QQ 音频降级缓存可能长到 GB 级：周期回收孤儿文件并按 LRU 压回容量上限。
  // 缓存回收失败不应该连带中止其他清理任务。
  try {
    pruneQQMusicAudioCache();
  } catch (error) {
    console.warn("[maintenance] QQ 音频缓存回收失败", error instanceof Error ? error.message : error);
  }
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
