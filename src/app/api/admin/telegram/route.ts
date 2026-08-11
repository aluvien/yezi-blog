import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { checkAndNotifyQQMusicHealth, getQQMusicHealthAlertState, qqMusicHealthStatusLabel } from "@/lib/qq-music-health";
import { isTelegramConfigured, sendTelegramTestNotification } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  const state = getQQMusicHealthAlertState();
  return noCache({
    configured: isTelegramConfigured(),
    qqMusic: {
      ...(state.lastStatus ? { status: state.lastStatus, label: qqMusicHealthStatusLabel(state.lastStatus) } : {}),
      lastCheckedAt: state.lastCheckedAt ?? null,
      lastDetail: state.lastDetail ?? null,
      lastNotifiedAt: state.lastNotifiedAt ?? null,
    },
  });
}

export async function POST(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  let body: { op?: unknown };
  try {
    body = await request.json();
  } catch {
    return noCache({ error: "请求格式错误" }, 400);
  }

  if (body.op === "test") {
    const result = await sendTelegramTestNotification();
    return result.ok ? noCache({ message: "测试通知已发送，请查看 Telegram" }) : noCache({ error: result.error ?? "测试通知发送失败" }, 502);
  }
  if (body.op === "check") {
    const result = await checkAndNotifyQQMusicHealth();
    return noCache({
      status: result.status,
      label: qqMusicHealthStatusLabel(result.status),
      detail: result.detail,
      checkedAt: result.checkedAt,
      notified: result.notified,
    });
  }
  return noCache({ error: "不支持的操作" }, 400);
}
