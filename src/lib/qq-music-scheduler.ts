import { getSiteSettings } from "@/lib/db";
import { checkAndNotifyQQMusicHealth } from "@/lib/qq-music-health";

export const QQ_MUSIC_HEALTH_INTERVALS = [1, 6, 12, 24] as const;

type SchedulerState = {
  started: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type SchedulerGlobal = typeof globalThis & {
  __yeziQQMusicHealthScheduler?: SchedulerState;
};

function state(): SchedulerState {
  const globalState = globalThis as SchedulerGlobal;
  if (!globalState.__yeziQQMusicHealthScheduler) {
    globalState.__yeziQQMusicHealthScheduler = { started: false, running: false };
  }
  return globalState.__yeziQQMusicHealthScheduler;
}

export function qqMusicHealthSchedulerConfig(settings = getSiteSettings()): { enabled: boolean; intervalHours: number } {
  const enabled = settings.qq_music_health_check_enabled !== "0";
  const candidate = Number(settings.qq_music_health_check_interval_hours ?? "6");
  const intervalHours = QQ_MUSIC_HEALTH_INTERVALS.includes(candidate as (typeof QQ_MUSIC_HEALTH_INTERVALS)[number]) ? candidate : 6;
  return { enabled, intervalHours };
}

function clearScheduledRun(current: SchedulerState): void {
  if (!current.timer) return;
  clearTimeout(current.timer);
  current.timer = undefined;
}

function schedule(current: SchedulerState, delayMs: number): void {
  clearScheduledRun(current);
  current.timer = setTimeout(() => { void runScheduledCheck(); }, delayMs);
  // The timer must not prevent PM2 from shutting down promptly during deploy.
  current.timer.unref?.();
}

async function runScheduledCheck(): Promise<void> {
  const current = state();
  current.timer = undefined;
  if (current.running) return;

  const config = qqMusicHealthSchedulerConfig();
  if (!config.enabled) return;

  current.running = true;
  try {
    await checkAndNotifyQQMusicHealth();
  } catch (error) {
    // The health-check function normally turns upstream failures into a result.
    // Keep the scheduler alive even if a filesystem or unexpected runtime error
    // escapes it; the next interval will retry.
    console.error("[qq-music-scheduler] 检测任务异常", error);
  } finally {
    current.running = false;
    const next = qqMusicHealthSchedulerConfig();
    if (next.enabled) schedule(current, next.intervalHours * 60 * 60 * 1000);
  }
}

/** Start once per Node process. The first check runs shortly after the server is ready. */
export function startQQMusicHealthScheduler(): void {
  const current = state();
  if (current.started) return;
  current.started = true;

  const config = qqMusicHealthSchedulerConfig();
  if (config.enabled) schedule(current, 1_000);
}

/** Apply a saved backend setting without requiring an external scheduler or restart. */
export function refreshQQMusicHealthScheduler(): void {
  const current = state();
  const config = qqMusicHealthSchedulerConfig();
  if (!config.enabled) {
    clearScheduledRun(current);
    return;
  }
  current.started = true;
  // A changed interval should take effect immediately; alert de-duplication in
  // the health module prevents repeated notifications for the same failure.
  schedule(current, 250);
}
