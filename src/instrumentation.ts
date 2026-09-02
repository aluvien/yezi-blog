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
    const startBackgroundWork = async (): Promise<void> => {
      const [{ enforceAdminPasswordFingerprint }, { startQQMusicHealthScheduler }, { startTelegramBotScheduler }, { resumeArticleReferenceArchiveJobs }, { startBackupScheduler }, { startMaintenanceScheduler }] = await Promise.all([
        import("./lib/db"),
        import("./lib/qq-music-scheduler"),
        import("./lib/telegram-bot-scheduler"),
        import("./lib/article-reference-archive-jobs"),
        import("./lib/backup-scheduler"),
        import("./lib/maintenance-scheduler"),
      ]);
      // 密码轮换后旧会话立即失效；放在后台启动同一入口，确保写闸门
      // （候选版本健康检查）释放后才会执行，回滚时不会留下半生效状态。
      const rotation = enforceAdminPasswordFingerprint();
      if (rotation.revoked) console.warn("[security] 检测到 ADMIN_PASSWORD 已变更，已撤销全部既有后台会话。");
      startMaintenanceScheduler();
      startQQMusicHealthScheduler();
      startTelegramBotScheduler();
      resumeArticleReferenceArchiveJobs();
      startBackupScheduler();
    };

    const { isDeploymentWriteHoldActive } = await import("./lib/deploy-write-guard");
    if (!isDeploymentWriteHoldActive()) {
      await startBackgroundWork();
      return;
    }

    // The deploy worker removes this guard only after health checks have
    // passed.  Polling a file is intentional: Proxy and this runtime do not
    // share a reliable global state, and a restart would reopen a write race.
    const timer = setInterval(() => {
      if (isDeploymentWriteHoldActive()) return;
      clearInterval(timer);
      void startBackgroundWork().catch((error) => console.error("[deployment] 启动后台任务失败", error));
    }, 200);
    timer.unref?.();
  }
}
