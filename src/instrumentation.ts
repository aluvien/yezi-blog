/** Initialize server-only background work once when a Next Node instance starts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startQQMusicHealthScheduler } = await import("./lib/qq-music-scheduler");
  startQQMusicHealthScheduler();
}
