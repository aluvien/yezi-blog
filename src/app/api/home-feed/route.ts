import { NextResponse } from "next/server";
import { HOME_FEED_BATCH_SIZE, getHomeFeedPage } from "@/lib/home-feed";
import { getVisitorKey } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

/** 首页滚动追加的公开、同源分页接口；不返回邮箱、IP 或后台字段。 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 10_000);
  const limit = boundedInteger(url.searchParams.get("limit"), HOME_FEED_BATCH_SIZE, 20);
  const page = getHomeFeedPage({ offset, limit: Math.max(1, limit), visitorKey: getVisitorKey(request) });
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
