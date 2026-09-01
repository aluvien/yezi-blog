import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { cityFromReverseGeocode } from "@/lib/moment-location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
let lastLookupAt = 0;

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function coordinate(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^-?\d{1,3}(?:\.\d{1,8})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** 将管理员经浏览器授权得到的坐标转换为城市文字；坐标不存储也不返回。 */
export async function GET(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const lat = coordinate(url.searchParams.get("lat"), -90, 90);
  const lng = coordinate(url.searchParams.get("lng"), -180, 180);
  if (lat === null || lng === null) return noCache({ error: "定位坐标无效" }, 400);

  const now = Date.now();
  if (now - lastLookupAt < 1_000) return noCache({ error: "定位请求过于频繁，请稍后重试" }, 429);
  lastLookupAt = now;

  try {
    const upstream = new URL(NOMINATIM_REVERSE_URL);
    upstream.searchParams.set("format", "jsonv2");
    upstream.searchParams.set("lat", String(lat));
    upstream.searchParams.set("lon", String(lng));
    upstream.searchParams.set("zoom", "10");
    upstream.searchParams.set("addressdetails", "1");
    const response = await fetch(upstream, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": "YeziBlog/1.0 (administrator location lookup)",
      },
    });
    if (!response.ok) throw new Error(`位置服务 ${response.status}`);
    const location = cityFromReverseGeocode(await response.json());
    if (!location) return noCache({ error: "未能识别所在地级市，请手动填写" }, 422);
    return noCache({ location });
  } catch (error) {
    console.warn("[moment-location] reverse geocoding failed", error instanceof Error ? error.message : error);
    return noCache({ error: "定位服务暂不可用，请手动填写城市" }, 502);
  }
}
