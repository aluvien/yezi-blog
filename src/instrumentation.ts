/** Initialize server-only background work once when a Next Node instance starts. */
export async function register(): Promise<void> {
  // 按 Next 16 的 instrumentation 约定使用可静态分析的 runtime 分支。
  // 把 Node-only sqlite/fs 依赖完全留在 nodejs bundle，避免开发构建误把它们编进浏览器/Edge。
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 后台同步的构建阶段只读正式数据库，不能顺带启动定时任务或 Telegram 轮询。
    if (process.env.BLOG_BUILD_READONLY === "true") return;
    const [{ startQQMusicHealthScheduler }, { startTelegramBotScheduler }] = await Promise.all([
      import("./lib/qq-music-scheduler"),
      import("./lib/telegram-bot-scheduler"),
    ]);
    startQQMusicHealthScheduler();
    startTelegramBotScheduler();
  }
}
