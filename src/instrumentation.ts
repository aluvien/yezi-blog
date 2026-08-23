/** Initialize server-only background work once when a Next Node instance starts. */
export async function register(): Promise<void> {
  // 按 Next 16 的 instrumentation 约定使用可静态分析的 runtime 分支。
  // 把 Node-only sqlite/fs 依赖完全留在 nodejs bundle，避免开发构建误把它们编进浏览器/Edge。
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 后台同步的构建阶段只读正式数据库，不能顺带启动定时任务或 Telegram 轮询。
    if (process.env.BLOG_BUILD_READONLY === "true") return;
    if (process.env.NODE_ENV === "production" && !["true", "false"].includes(process.env.TRUST_PROXY ?? "")) {
      console.warn("[security] 生产环境请显式设置 TRUST_PROXY=true（仅可信反代）或 false（直连）；未设置会让访客共用 unknown 限频键。");
    }
    const [{ startQQMusicHealthScheduler }, { startTelegramBotScheduler }, { resumeArticleReferenceArchiveJobs }, { startBackupScheduler }, { cleanupExpiredAuthState }] = await Promise.all([
      import("./lib/qq-music-scheduler"),
      import("./lib/telegram-bot-scheduler"),
      import("./lib/article-reference-archive-jobs"),
      import("./lib/backup-scheduler"),
      import("./lib/db/session-auth"),
    ]);
    cleanupExpiredAuthState();
    startQQMusicHealthScheduler();
    startTelegramBotScheduler();
    resumeArticleReferenceArchiveJobs();
    startBackupScheduler();
  }
}
