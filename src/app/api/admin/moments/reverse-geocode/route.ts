import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { cityFromReverseGeocode } from "@/lib/moment-location";
import { readLimitedJson, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
let lastLookupAt = 0;

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

// 浏览器返回的坐标精度因设备而异；城市级逆地理编码最多需要 6 位小数，
// 主动降精度既满足需求，也减少发给第三方位置服务的精确信息。
function coordinate(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value.toFixed(6);
}

/**
 * 将管理员经浏览器授权得到的坐标转换为城市文字；坐标不存储也不返回。
 * 精确坐标只允许出现在 POST JSON 请求体里：GET 查询串会进入应用与
 * 反向代理的访问日志，请求体则不会被任何 access log 记录。
 * Cookie 会话的 POST 由 requireAdminApi 强制同源与 CSRF 头校验。
 */
export async function POST(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录" }, 401);
  let body: unknown;
  try {
    body = await readLimitedJson(request, 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return noCache({ error: "请求体必须是包含 lat 与 lng 的 JSON" }, status);
  }
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const lat = coordinate(payload.lat, -90, 90);
  const lng = coordinate(payload.lng, -180, 180);
  if (lat === null || lng === null) return noCache({ error: "定位坐标无效" }, 400);

  const now = Date.now();
  if (now - lastLookupAt < 1_000) return noCache({ error: "定位请求过于频繁，请稍后重试" }, 429);
  lastLookupAt = now;

  try {
    const upstream = new URL(NOMINATIM_REVERSE_URL);
    upstream.searchParams.set("format", "jsonv2");
    upstream.searchParams.set("lat", lat);
    upstream.searchParams.set("lon", lng);
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
