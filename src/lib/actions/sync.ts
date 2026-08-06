"use server";

import { requireAdmin } from "@/lib/auth";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** 在服务端触发服务器拉取 GitHub main 并部署，避免把 access_key 暴露给浏览器。 */
export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();

  const hookUrl = process.env.GITHUB_SYNC_HOOK_URL?.trim();
  if (!hookUrl) return { ok: false, error: "未配置 GITHUB_SYNC_HOOK_URL" };

  try {
    const response = await fetch(hookUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      // hook 返回非 JSON 时按失败处理，并在界面显示状态码。
    }

    if (!response.ok) return { ok: false, error: `同步请求失败（HTTP ${response.status}）` };
    if (payload && typeof payload === "object" && "code" in payload && Number(payload.code) === 1) {
      return { ok: true, message: "同步成功，服务器已拉取 GitHub 最新源码。" };
    }

    const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message ?? "") : "";
    return { ok: false, error: message || "服务器未确认同步成功" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求异常";
    return { ok: false, error: `同步请求失败：${message}` };
  }
}
