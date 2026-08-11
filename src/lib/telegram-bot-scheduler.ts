import { isTelegramConfigured, registerTelegramBotCommands } from "@/lib/telegram";
import { processTelegramBotUpdates } from "@/lib/telegram-bot";

type SchedulerState = {
  started: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type SchedulerGlobal = typeof globalThis & {
  __yeziTelegramBotScheduler?: SchedulerState;
};

const POLL_INTERVAL_MS = 3_000;

function state(): SchedulerState {
  const globalState = globalThis as SchedulerGlobal;
  if (!globalState.__yeziTelegramBotScheduler) globalState.__yeziTelegramBotScheduler = { started: false, running: false };
  return globalState.__yeziTelegramBotScheduler;
}

function schedule(current: SchedulerState, delayMs: number): void {
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => { void run(); }, delayMs);
  current.timer.unref?.();
}

async function run(): Promise<void> {
  const current = state();
  current.timer = undefined;
  if (current.running) return;
  current.running = true;
  try {
    await processTelegramBotUpdates();
  } catch (error) {
    console.error("[telegram-bot] 指令轮询异常", error);
  } finally {
    current.running = false;
    if (isTelegramConfigured()) schedule(current, POLL_INTERVAL_MS);
  }
}

/** Start a single long-poll style loop per Node process; no webhook or cron is required. */
export function startTelegramBotScheduler(): void {
  const current = state();
  if (current.started || !isTelegramConfigured()) return;
  current.started = true;
  void registerTelegramBotCommands();
  schedule(current, 1_500);
}
