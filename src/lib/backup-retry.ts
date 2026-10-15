export type BackupAttemptState = { failures: number; localComplete: boolean; alerted: boolean };
export type BackupAttemptDependencies = {
  local: () => Promise<void>; cloud: () => Promise<void>; notify: (message: string) => Promise<boolean>;
};
const RETRIES = [60_000, 5 * 60_000, 15 * 60_000];
export function isDatabaseNotInitializedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("数据库不存在：");
}
export function backupRetryDelay(error: unknown, normalDelay: number, failures = 1): number {
  if (isDatabaseNotInitializedError(error)) return Math.min(60_000, normalDelay);
  return Math.min(RETRIES[failures - 1] ?? normalDelay, normalDelay);
}
function reason(error: unknown): string {
  return (error instanceof Error ? error.message : "未知错误")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/(authorization|password|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 300);
}

/** Retry cloud upload independently once the local backup has succeeded. */
export async function runBackupAttempt(state: BackupAttemptState, deps: BackupAttemptDependencies, normalDelay: number): Promise<number> {
  const notify = async (message: string) => { try { return await deps.notify(message); } catch { return false; } };
  try {
    if (!state.localComplete) { await deps.local(); state.localComplete = true; }
    await deps.cloud();
    if (state.alerted) await notify("✅ 自动备份已恢复\n\n本轮本地备份和已启用的云备份均已完成。");
    state.failures = 0; state.localComplete = false; state.alerted = false;
    return normalDelay;
  } catch (error) {
    if (isDatabaseNotInitializedError(error)) return backupRetryDelay(error, normalDelay);
    state.failures += 1;
    const exhausted = state.failures > RETRIES.length;
    const delay = backupRetryDelay(error, normalDelay, state.failures);
    console.error("[backup-scheduler] 自动备份失败", reason(error));
    if (!state.alerted || exhausted) {
      const sent = await notify(`⚠️ 自动备份${exhausted ? "多次重试仍失败" : "失败"}\n\n阶段：${state.localComplete ? "云端备份" : "本地备份"}\n原因：${reason(error)}\n${exhausted ? "本轮重试已结束，下次每日计划继续尝试，请检查后台备份设置。" : `将在约 ${Math.max(1, Math.ceil(delay / 60_000))} 分钟后自动重试。`}`);
      state.alerted ||= sent;
    }
    if (exhausted) { state.failures = 0; state.localComplete = false; }
    return delay;
  }
}
