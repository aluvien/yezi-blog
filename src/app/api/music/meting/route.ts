import { NextResponse } from "next/server";
import { getSiteSettings } from "@/lib/db";
import { buildMetingUrl, DEFAULT_METING_API, parseMusicSpec } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Meting 服务暂不可用";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const server = url.searchParams.get("server")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  const resource = url.searchParams.get("resource")?.trim().toLowerCase() ?? "";
  const metingApi = getSiteSettings().meting_api?.trim() || DEFAULT_METING_API;

  // Lyrics are requested by the article cards directly in the browser. Proxy
  // them through the same server-side Meting connection as the track request
  // so CORS differences cannot make the player have lyrics while the article
  // card shows none.
  if (resource === "lrc") {
    const spec = parseMusicSpec(`${server}:${id}:song`);
    if (!spec || spec.server === "qqvip") {
      return NextResponse.json(
        { error: "歌词参数无效" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    try {
      const endpoint = new URL(metingApi);
      endpoint.searchParams.set("server", spec.server);
      endpoint.searchParams.set("id", spec.id);
      endpoint.searchParams.set("type", "lrc");
      const response = await fetch(endpoint, {
        headers: { accept: "text/plain, text/*, application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          "cache-control": "no-store",
          "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: errorMessage(error) },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  }

  const type = url.searchParams.get("type")?.trim() ?? "song";
  const spec = parseMusicSpec(`${server}:${id}:${type}`);

  if (!spec || spec.server === "qqvip") {
    return NextResponse.json(
      { error: "音乐参数无效" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const response = await fetch(buildMetingUrl(metingApi, spec), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "cache-control": "no-store",
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
