/** Initialize server-only background work once when a Next Node instance starts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startQQMusicHealthScheduler }, { startTelegramBotScheduler }] = await Promise.all([
    import("./lib/qq-music-scheduler"),
    import("./lib/telegram-bot-scheduler"),
  ]);
  startQQMusicHealthScheduler();
  startTelegramBotScheduler();
}
