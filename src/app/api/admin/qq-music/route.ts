import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  findArray,
  findRecord,
  findString,
  getRecordString,
  normalizeQQCover,
  qqMusicRequest,
  readUin,
  singerNames,
  type JsonRecord,
  unwrapData,
} from "@/lib/qq-music-api";
import { getQQMusicSession, saveQQMusicSession } from "@/lib/qq-music-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "QQ 音乐服务暂不可用";
}

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function qrImage(value: unknown): string {
  // qq-music-api v2.4 returns `img`; older releases used qrCode/qrcode.
  const raw = findString(value, ["img", "image", "qrCode", "qrcode", "qr", "base64", "dataUrl"]);
  if (!raw) return "";
  if (raw.startsWith("data:image/") || raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // The sidecar currently returns a bare Base64 PNG. Make it browser-displayable.
  return /^[a-zA-Z0-9+/=\s]+$/.test(raw) ? `data:image/png;base64,${raw.replace(/\s/g, "")}` : "";
}

function normalizeSearch(raw: unknown) {
  const data = unwrapData(raw);
  const songRoot = findRecord(data, ["song", "songs"]);
  const list = findArray(songRoot ?? data, ["list", "songList", "songs"]);
  return list.flatMap((item) => {
    const song = asRecord(item);
    if (!song) return [];
    const mid = getRecordString(song, ["songmid", "mid", "songMid"]);
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return [];
    const album = asRecord(song.album);
    const albumMid = album ? getRecordString(album, ["mid", "albummid", "albumMid"]) : "";
    const cover = normalizeQQCover(
      getRecordString(song, ["cover", "pic", "image"]) || (album ? getRecordString(album, ["pic", "cover", "image"]) : ""),
    ) || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "");
    return [{
      mid,
      name: getRecordString(song, ["songname", "name", "title"]) || "未知歌曲",
      artist: singerNames(song.singer ?? song.singers) || getRecordString(song, ["singername", "artist", "author"]),
      album: album ? getRecordString(album, ["name", "title", "albumName"]) : getRecordString(song, ["albumname", "albumName"]),
      cover,
    }];
  }).slice(0, 30);
}

async function status() {
  // `qq-music-api` v2.4's getCookie/setCookie routes do not share the QR login
  // state. The durable session is the source of truth for login state. Its
  // health probe is deliberately best-effort: an upstream hiccup must not turn
  // a valid local login into a 502 / “server internal error” in the admin UI.
  const session = getQQMusicSession();
  try {
    await qqMusicRequest("/getHotkey", { useSession: false });
    return { available: true, loggedIn: Boolean(session), uin: session?.uin ?? null };
  } catch {
    return { available: false, loggedIn: Boolean(session), uin: session?.uin ?? null };
  }
}

export async function GET(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "status";
  try {
    if (op === "status") return noCache(await status());
    if (op === "qr") {
      const raw = await qqMusicRequest("/getQQLoginQr", { useSession: false });
      const image = qrImage(raw);
      const qrsig = findString(raw, ["qrsig"]);
      const ptqrtoken = findString(raw, ["ptqrtoken"]);
      if (!image || !qrsig) return noCache({ error: "未能生成 QQ 登录二维码，请检查 QQ 音乐服务日志" }, 502);
      return noCache({ image, qrsig, ptqrtoken });
    }
    if (op === "search") {
      const key = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
      if (!key) return noCache({ error: "请输入歌曲或歌手" }, 400);
      const raw = await qqMusicRequest("/getSearchByKey", { query: { key, limit: "30" } });
      return noCache({ tracks: normalizeSearch(raw) });
    }
    return noCache({ error: "不支持的操作" }, 400);
  } catch (error) {
    return noCache({ error: errorMessage(error), available: false }, 502);
  }
}

export async function POST(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  let body: { op?: unknown; qrsig?: unknown; ptqrtoken?: unknown };
  try {
    body = await request.json();
  } catch {
    return noCache({ error: "请求格式错误" }, 400);
  }
  if (body.op !== "poll") return noCache({ error: "不支持的操作" }, 400);
  const qrsig = String(body.qrsig ?? "").trim();
  const ptqrtoken = String(body.ptqrtoken ?? "").trim();
  if (!qrsig || qrsig.length > 512 || ptqrtoken.length > 512) return noCache({ error: "二维码信息无效，请重新获取" }, 400);

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
    return noCache({ state: "pending", message: message || "请使用手机 QQ 扫码并确认登录" });
  } catch (error) {
    return noCache({ error: errorMessage(error) }, 502);
  }
}
