import crypto from "node:crypto";
import { db } from "@/lib/db/core";
import { parseMusicSpec, type MusicSpec } from "@/lib/music";

const ACCESS_CACHE_MS = 5_000;
const LYRIC_TOKEN_TTL_SECONDS = 10 * 60;

type AccessCache = { expiresAt: number; keys: Set<string> };
type AccessGlobal = typeof globalThis & { __yeziQQAccess?: AccessCache; __yeziQQLyricSecret?: Buffer };

export function extractMusicSpecs(text: string): MusicSpec[] {
  const matches = text.match(/qqvip:[A-Za-z0-9_-]{4,80}:(?:song|playlist)(?::(?:random|shuffle|meta-[^\s`<>]+))?/g) ?? [];
  const unique = new Map<string, MusicSpec>();
  for (const value of matches) {
    const spec = parseMusicSpec(value);
    if (spec) unique.set(`${spec.type}:${spec.id}`, spec);
  }
  return [...unique.values()];
}

function publicMusicSpecs(): MusicSpec[] {
  const rows = db.prepare(`
    SELECT content AS value FROM posts WHERE status = 'published'
    UNION ALL SELECT content AS value FROM moments
    UNION ALL SELECT value FROM site_settings WHERE key IN ('about_content', 'default_music')
  `).all() as Array<{ value: string }>;
  return collectMusicSpecs(rows);
}

function collectMusicSpecs(rows: Array<{ value: string }>): MusicSpec[] {
  const unique = new Map<string, MusicSpec>();
  for (const row of rows) {
    for (const spec of extractMusicSpecs(row.value ?? "")) unique.set(`${spec.type}:${spec.id}`, spec);
  }
  return [...unique.values()];
}

function accessKeys(): Set<string> {
  const state = globalThis as AccessGlobal;
  const cached = state.__yeziQQAccess;
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const keys = new Set(publicMusicSpecs().map((spec) => `${spec.type}:${spec.id}`));
  state.__yeziQQAccess = { expiresAt: Date.now() + ACCESS_CACHE_MS, keys };
  return keys;
}

export function invalidateQQMusicAccessCache(): void {
  (globalThis as AccessGlobal).__yeziQQAccess = undefined;
}

export function isPublicQQMusicSpec(type: "song" | "playlist", id: string): boolean {
  return accessKeys().has(`${type}:${id}`);
}

/** 所有已保存内容中的歌曲来源；草稿也保留，避免未来发布时重复请求 QQ 音乐。 */
export function listReferencedQQMusicSongIds(): Set<string> {
  const rows = db.prepare(`
    SELECT content AS value FROM posts
    UNION ALL SELECT content AS value FROM moments
    UNION ALL SELECT value FROM site_settings WHERE key IN ('about_content', 'default_music')
  `).all() as Array<{ value: string }>;
  return new Set(collectMusicSpecs(rows).flatMap((spec) => spec.type === "song" ? [spec.id] : []));
}

function lyricSecret(): Buffer {
  const state = globalThis as AccessGlobal;
  if (state.__yeziQQLyricSecret) return state.__yeziQQLyricSecret;
  const configured = process.env.QQ_MUSIC_SIGNING_KEY?.trim();
  state.__yeziQQLyricSecret = configured && configured.length >= 32
    ? crypto.createHash("sha256").update(configured).digest()
    : crypto.randomBytes(32);
  return state.__yeziQQLyricSecret;
}

function lyricSignature(mid: string, expiresAt: number): string {
  return crypto.createHmac("sha256", lyricSecret()).update(`lyric:${mid}:${expiresAt}`).digest("base64url");
}

export function createLyricAuthorization(mid: string, referenceTime = Date.now()): string {
  const expiresAt = Math.floor(referenceTime / 1000) + LYRIC_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${lyricSignature(mid, expiresAt)}`;
}

export function verifyLyricAuthorization(mid: string, token: string, referenceTime = Date.now()): boolean {
  const match = token.match(/^(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(referenceTime / 1000)) return false;
  const expected = Buffer.from(lyricSignature(mid, expiresAt));
  const supplied = Buffer.from(match[2]);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function lyricUrl(mid: string): string {
  const token = createLyricAuthorization(mid);
  return `/api/music/qq?mid=${encodeURIComponent(mid)}&type=lyric&token=${encodeURIComponent(token)}`;
}
