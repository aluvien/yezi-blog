import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  findString,
  normalizeQQPlaylists,
  normalizeQQSearchTracks,
  qqMusicRequest,
  readUin,
  searchQQPlaylists,
  type QQPlaylistSummary,
} from "@/lib/qq-music-api";
import {
  cancelNativeQQMusicQr,
  createNativeQQMusicQr,
  pollNativeQQMusicQr,
  validateNativeQQMusicRuntime,
} from "@/lib/qq-music-native-login";
import { getQQMusicSession, saveQQMusicSession } from "@/lib/qq-music-session";
import { inspectQQMusicHealth, qqMusicHealthStatusLabel } from "@/lib/qq-music-health";
import { cleanupUnusedQQMusicMetadata, upsertQQMusicMetadata } from "@/lib/db";
import { listReferencedQQMusicSongIds } from "@/lib/qq-music-access";
import { readLimitedJson, RequestBodyError } from "@/lib/request";
import {
  QQ_LOGIN_SOURCE,
  QQ_MUSIC_APP_SOURCE,
  QQ_MUSIC_WEB_SOURCE,
  type ServiceSource,
  withSource,
} from "@/lib/service-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown, source: ServiceSource = QQ_MUSIC_WEB_SOURCE): string {
  return withSource(error instanceof Error ? error.message : "QQ 音乐服务暂不可用", source);
}

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function qrImage(value: unknown): string {
  // qq-music-api v2.4 returns `img`; older releases used qrCode/qrcode.
  const raw = findString(value, ["img", "image", "qrCode", "qrcode", "qr", "base64", "dataUrl"]);
  if (!raw) return "";
  if (raw.startsWith("data:image/") || raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // The sidecar currently returns a bare Base64 PNG. Make it browser-displayable.
  return /^[a-zA-Z0-9+/=\s]+$/.test(raw) ? `data:image/png;base64,${raw.replace(/\s/g, "")}` : "";
}

function mergePlaylists(...groups: QQPlaylistSummary[][]): QQPlaylistSummary[] {
  const seen = new Set<string>();
  return groups.flat().filter((playlist) => {
    if (seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  }).slice(0, 200);
}

async function status() {
  const session = getQQMusicSession();
  const health = await inspectQQMusicHealth();
  return {
    available: health.status !== "unavailable",
    loggedIn: Boolean(session),
    playable: health.status === "healthy",
    healthStatus: health.status,
    label: qqMusicHealthStatusLabel(health.status),
    detail: health.detail,
    checkedAt: health.checkedAt,
    uin: session?.uin ?? null,
  };
}

export async function GET(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "status";
  try {
    if (op === "status") return noCache(await status());
    if (op === "qr") {
      const raw = await qqMusicRequest("/getQQLoginQr", { useSession: false });
      const image = qrImage(raw);
      const qrsig = findString(raw, ["qrsig"]);
      const ptqrtoken = findString(raw, ["ptqrtoken"]);
      if (!image || !qrsig) {
        return noCache({ error: withSource("未能生成 QQ 登录二维码，请检查 QQ 音乐服务日志", QQ_LOGIN_SOURCE), source: QQ_LOGIN_SOURCE }, 502);
      }
      return noCache({ channel: "qq", image, qrsig, ptqrtoken, expiresAt: Date.now() + 2 * 60 * 1000, source: QQ_LOGIN_SOURCE });
    }
    if (op === "native-qr") {
      const qr = await createNativeQQMusicQr();
      return noCache({ channel: "qqmusic", ...qr });
    }
    if (op === "native-runtime") {
      validateNativeQQMusicRuntime();
      return noCache({ ready: true });
    }
    if (op === "search") {
      const key = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
      const type = url.searchParams.get("type") === "playlist" ? "playlist" : "song";
      if (!key) return noCache({ error: type === "playlist" ? "请输入歌单名称" : "请输入歌曲或歌手" }, 400);
      if (type === "playlist") {
        return noCache({ playlists: await searchQQPlaylists(key, 30) });
      }
      const raw = await qqMusicRequest("/getSearchByKey", { query: { key, limit: "30" } });
      const tracks = normalizeQQSearchTracks(raw);
      upsertQQMusicMetadata(tracks);
      return noCache({ tracks });
    }
    if (op === "playlists") {
      const session = getQQMusicSession();
      if (!session) return noCache({ error: "请先扫码登录 QQ 音乐" }, 409);
      const [createdResult, collectedResult] = await Promise.allSettled([
        qqMusicRequest("/user/getUserPlaylists", {
          query: { uin: session.uin, offset: "0", limit: "100" },
        }),
        qqMusicRequest("/user/getUserCollectedSongLists", {
          query: { uin: session.uin, page: "1", limit: "100" },
        }),
      ]);
      if (createdResult.status === "rejected" && collectedResult.status === "rejected") {
        throw createdResult.reason;
      }
      const created = createdResult.status === "fulfilled"
        ? normalizeQQPlaylists(createdResult.value, "created", 100)
        : [];
      const collected = collectedResult.status === "fulfilled"
        ? normalizeQQPlaylists(collectedResult.value, "collected", 100)
        : [];
      const warnings = [
        ...(createdResult.status === "rejected" ? [`自建歌单读取失败：${errorMessage(createdResult.reason, QQ_MUSIC_WEB_SOURCE)}`] : []),
        ...(collectedResult.status === "rejected" ? [`收藏歌单读取失败：${errorMessage(collectedResult.reason, QQ_MUSIC_WEB_SOURCE)}`] : []),
      ];
      return noCache({
        playlists: mergePlaylists(created, collected),
        counts: { created: created.length, collected: collected.length },
        ...(warnings.length > 0 ? { warning: warnings.join("；") } : {}),
      });
    }
    return noCache({ error: "不支持的操作" }, 400);
  } catch (error) {
    const source = op === "qr" ? QQ_LOGIN_SOURCE : op === "native-qr" ? QQ_MUSIC_APP_SOURCE : QQ_MUSIC_WEB_SOURCE;
    return noCache({ error: errorMessage(error, source), source, available: false }, 502);
  }
}

export async function POST(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录或请求来源无效" }, 401);
  let body: { op?: unknown; qrsig?: unknown; ptqrtoken?: unknown; key?: unknown };
  try {
    body = await readLimitedJson(request, 8 * 1024);
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "请求格式错误" }, error instanceof RequestBodyError ? error.status : 400);
  }
  if (body.op === "native-cancel") {
    const key = String(body.key ?? "").trim();
    cancelNativeQQMusicQr(key);
    return noCache({ ok: true, source: QQ_MUSIC_APP_SOURCE });
  }
  if (body.op === "cleanup-metadata-cache") {
    const referenced = listReferencedQQMusicSongIds();
    const deleted = cleanupUnusedQQMusicMetadata(referenced);
    return noCache({ deleted, referenced: referenced.size });
  }
  if (body.op === "native-poll") {
    const key = String(body.key ?? "").trim();
    try {
      const result = await pollNativeQQMusicQr(key);
      if (result.state === "success" && result.cookie && result.uin) {
        saveQQMusicSession({ cookie: result.cookie, uin: result.uin });
        return noCache({ state: "success", uin: result.uin, message: result.message, source: result.source });
      }
      return noCache(result);
    } catch (error) {
      return noCache({ error: errorMessage(error, QQ_MUSIC_APP_SOURCE), source: QQ_MUSIC_APP_SOURCE }, 502);
    }
  }
  if (body.op !== "poll") return noCache({ error: "不支持的操作" }, 400);
  const qrsig = String(body.qrsig ?? "").trim();
  const ptqrtoken = String(body.ptqrtoken ?? "").trim();
  if (!qrsig || qrsig.length > 512 || ptqrtoken.length > 512) {
    return noCache({ error: withSource("二维码信息无效，请重新获取", QQ_LOGIN_SOURCE), source: QQ_LOGIN_SOURCE }, 400);
  }

  try {
    const raw = await qqMusicRequest("/checkQQLoginQr", { method: "POST", body: { qrsig, ptqrtoken }, useSession: false });
    const cookie = findString(raw, ["cookie"]);
    const uin = readUin(raw);
    if (cookie && uin) {
      // The upstream API does not persist QR sessions reliably. Keep the
      // account cookie in the blog's protected data directory and pass it only
      // over the localhost request header on subsequent API calls.
      saveQQMusicSession({ cookie, uin });
      return noCache({ state: "success", uin });
    }
    const message = findString(raw, ["message", "msg", "error", "status"]);
    return noCache({ state: "pending", message: message || "请使用手机 QQ 扫码并确认登录", source: QQ_LOGIN_SOURCE });
  } catch (error) {
    return noCache({ error: errorMessage(error, QQ_LOGIN_SOURCE), source: QQ_LOGIN_SOURCE }, 502);
  }
}
