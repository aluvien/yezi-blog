import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { acquireProcessLock, releaseProcessLock } from "../../scripts/process-lock.mjs";
import { getProjectRoot } from "@/lib/uploads";
import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";

const context = new AsyncLocalStorage<{ active: boolean }>();
const BUSY = "备份、恢复或附件任务正在处理文件，请稍后重试。";

/** The restore safety backup can reuse its enclosing lease. Other processes
 * share the same on-disk lock, including after an interrupted task. */
export async function withDataFilesLock<T>(run: () => Promise<T>, timeoutMs = 30_000, reentrant = true): Promise<T> {
  if (reentrant && context.getStore()?.active) return run();
  const directory = path.join(getProjectRoot(), "data");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let lock: ReturnType<typeof acquireProcessLock>;
  for (;;) {
    try { lock = acquireProcessLock(path.join(directory, ".data-files.lock"), BUSY); break; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== BUSY || Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
  const scope = { active: true };
  try { return await context.run(scope, run); }
  finally { scope.active = false; releaseProcessLock(lock); }
}

/** Capture epoch before any awaited preparation. Once inside the lease, a
 * restore waits for the entire file/record operation and its compensation. */
export async function withDataFileMutation<T>(run: () => Promise<T>, epoch = currentDataEpoch()): Promise<T> {
  const rejected = dataWriteRejection(epoch);
  if (rejected) throw new Error(rejected);
  return withDataFilesLock(async () => {
    const changed = dataWriteRejection(epoch);
    if (changed) throw new Error(changed);
    return run();
  }, 30_000, false);
}
