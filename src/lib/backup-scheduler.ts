import { runDbBackup, lastBackupTimestamp } from "@/lib/backup";
import { runCompleteDataBackup } from "@/lib/data-backup";

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIALIZATION_RETRY_MS = 60 * 1000;
// 本地凌晨 4:17 跑每日备份，避开 4:00 整点的计划任务高峰。
const BACKUP_HOUR = 4;
const BACKUP_MINUTE = 17;

type SchedulerState = {
  started: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type SchedulerGlobal = typeof globalThis & {
  __yeziBackupScheduler?: SchedulerState;
};

function state(): SchedulerState {
  const globalState = globalThis as SchedulerGlobal;
  if (!globalState.__yeziBackupScheduler) {
    globalState.__yeziBackupScheduler = { started: false, running: false };
  }
  return globalState.__yeziBackupScheduler;
}

/** 距下一个本地 04:17 的毫秒数。 */
function msUntilNextBackup(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(BACKUP_HOUR, BACKUP_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function clearScheduledRun(current: SchedulerState): void {
  if (!current.timer) return;
  clearTimeout(current.timer);
  current.timer = undefined;
}

/** A newly deployed site may not have served its first request and created SQLite yet. */
export function isDatabaseNotInitializedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("数据库不存在：");
}

export function backupRetryDelay(error: unknown, normalDelay: number): number {
  return isDatabaseNotInitializedError(error) ? Math.min(INITIALIZATION_RETRY_MS, normalDelay) : normalDelay;
}

function schedule(current: SchedulerState, delayMs: number): void {
  clearScheduledRun(current);
  current.timer = setTimeout(() => {
    void runScheduledBackup();
  }, delayMs);
  // 定时器不能阻止 PM2 在部署时快速退出。
  current.timer.unref?.();
}

async function runScheduledBackup(): Promise<void> {
  const current = state();
  current.timer = undefined;
  if (current.running) return;
  current.running = true;
  let nextDelay = msUntilNextBackup();
  try {
    if (process.env.DATA_BACKUP_KEY?.trim()) {
      const result = await runCompleteDataBackup();
      console.log(`[backup-scheduler] 每日完整加密备份完成：${result.mirroredPath || result.path}`);
    } else {
      const result = await runDbBackup();
      console.log(`[backup-scheduler] 每日数据库备份完成：${result.path}；未配置 DATA_BACKUP_KEY，完整数据归档未启用`);
    }
  } catch (error) {
    nextDelay = backupRetryDelay(error, nextDelay);
    if (isDatabaseNotInitializedError(error)) {
      // 首次请求会创建数据库；不要在新部署尚未有数据时制造一次伪失败或等到次日才重试。
      console.info("[backup-scheduler] 数据库尚未初始化，将在一分钟后重试");
    } else {
      // 备份失败不影响站点运行，下个周期自动重试。
      console.error("[backup-scheduler] 每日备份失败", error instanceof Error ? error.message : error);
    }
  } finally {
    current.running = false;
    schedule(current, nextDelay);
  }
}

/**
 * 每个 Node 进程启动一次。首次备份时间：距上次备份超过 24h（或从未备份）
 * 则启动后稍等即补一次，否则等到下一个本地 04:17。
 */
export function startBackupScheduler(): void {
  const current = state();
  if (current.started) return;
  current.started = true;

  const last = lastBackupTimestamp();
  const initialDelay = last === null || Date.now() - last > DAY_MS ? 3_000 : msUntilNextBackup();
  schedule(current, initialDelay);
}
