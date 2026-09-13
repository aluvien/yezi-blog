import crypto from "node:crypto";
import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";
import {
  deleteQQMusicAudioCache,
  deleteQQMusicLyricCache,
  getQQMusicAudioCache,
  listQQMusicAudioCache,
  touchQQMusicAudioCache,
  upsertQQMusicAudioCache,
} from "@/lib/db";
import { getProjectRoot } from "@/lib/uploads";

/**
 * QQ 音乐播放授权降级用的音频字节缓存。
 *
 * 设计前提：QQ 的播放地址（purl）是短时效签名地址，缓存它没有任何意义，
 * 因此这里下载并保存的是音频字节本体，落盘于 data/qq-music-audio/。
 * 正常播放仍然实时向 QQ 请求；只有在授权失效导致解析失败时，路由才把这里的
 * 文件地址交给播放器，从而让「已经放过的歌」在掉登录态后依然可播。
 *
 * 安全边界：
 * - 只接受 https 的 purl，且响应必须是音频类型，避免把 QQ 的错误页当成音频存下来。
 * - 单文件与总量都有上限，超限直接放弃缓存而不是写坏磁盘。
 * - 下载不携带登录 Cookie：purl 自带签名，把 Cookie 发给第三方 CDN 只会扩大泄露面。
 */

const MID_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;
const AUDIO_DIRECTORY_NAME = "qq-music-audio";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_WARM_CONCURRENCY = 2;
const MAX_WARM_QUEUE = 64;
const DEFAULT_MAX_FILE_MB = 40;
const DEFAULT_MAX_TOTAL_MB = 2_048;
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".ape": "audio/x-ape",
};

const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/aacp": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/opus": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/x-ape": ".ape",
};

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 缓存默认开启；显式设置 QQ_MUSIC_AUDIO_CACHE_ENABLED=0 可整体关闭。 */
export function qqMusicAudioCacheEnabled(): boolean {
  return process.env.QQ_MUSIC_AUDIO_CACHE_ENABLED?.trim() !== "0";
}

export function audioCacheMaxFileBytes(): number {
  return Math.trunc(positiveNumberFromEnv("QQ_MUSIC_AUDIO_CACHE_MAX_FILE_MB", DEFAULT_MAX_FILE_MB) * 1024 * 1024);
}

export function audioCacheMaxTotalBytes(): number {
  return Math.trunc(positiveNumberFromEnv("QQ_MUSIC_AUDIO_CACHE_MAX_TOTAL_MB", DEFAULT_MAX_TOTAL_MB) * 1024 * 1024);
}

export function audioCacheDirectory(): string {
  return path.join(getProjectRoot(), "data", AUDIO_DIRECTORY_NAME);
}

/** 把 /api/music/qq?type=audio 的站内地址交给播放器，浏览器不直接接触 QQ 域名。 */
export function cachedAudioUrl(mid: string): string {
  return `/api/music/qq?id=${encodeURIComponent(mid)}&type=audio`;
}

function audioCacheAbsolutePath(fileName: string): string | null {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return null;
  const root = audioCacheDirectory();
  const target = path.resolve(root, fileName);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function removeAudioFile(fileName: string): boolean {
  const absolute = audioCacheAbsolutePath(fileName);
  if (!absolute) return false;
  try {
    fs.unlinkSync(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 purl 的扩展名与响应 Content-Type 共同推断容器格式。
 * 两者都判断不出音频时返回 null：QQ 在授权异常时会返回 200 的 JSON 错误页，
 * 那种响应绝不能被当成可播放文件写进缓存。
 */
function resolveAudioFormat(url: string, contentType: string): { extension: string; mime: string } | null {
  const normalizedType = contentType.split(";")[0].trim().toLowerCase();
  let extension = "";
  try {
    const candidate = path.extname(new URL(url).pathname).toLowerCase();
    if (AUDIO_MIME_BY_EXTENSION[candidate]) extension = candidate;
  } catch {
    // purl 在调用前已通过 https 校验，这里只是格式推断失败时的兜底。
  }
  const mime = AUDIO_EXTENSION_BY_MIME[normalizedType] ? normalizedType : "";
  if (!extension && mime) extension = AUDIO_EXTENSION_BY_MIME[mime];
  if (!extension && normalizedType.startsWith("audio/")) extension = ".mp3";
  if (!extension) return null;
  return {
    extension,
    mime: mime || AUDIO_MIME_BY_EXTENSION[extension] || "audio/mpeg",
  };
}

async function downloadAudioToCache(mid: string, purl: string): Promise<boolean> {
  const response = await fetch(purl, {
    headers: { referer: "https://y.qq.com/", "user-agent": BROWSER_USER_AGENT },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) return false;

  const format = resolveAudioFormat(purl, response.headers.get("content-type") ?? "");
  if (!format) return false;

  const limit = audioCacheMaxFileBytes();
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return false;

  const directory = audioCacheDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fileName = `${mid}${format.extension}`;
  const destination = path.join(directory, fileName);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  // 必须先用 openSync 把文件真实创建出来：createWriteStream 的 open 是异步的，
  // 一旦读取循环立刻抛错（例如超过上限），finally 里的 unlink 会赶在 open 之前
  // 执行，于是失败路径反而在磁盘上留下一个无人回收的 .tmp 文件。
  const handle = fs.openSync(temporary, "w", 0o600);
  const stream = fs.createWriteStream(temporary, { fd: handle, autoClose: true });
  let size = 0;

  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > limit) throw new Error("音频超过单文件缓存上限");
      if (!stream.write(Buffer.from(value))) await once(stream, "drain");
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    if (size === 0) throw new Error("音频响应为空");

    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);

    // 同一首歌换了容器格式时要清掉旧扩展名文件，否则会留下无法回收的副本。
    const previous = getQQMusicAudioCache(mid);
    if (previous && previous.file_name !== fileName) removeAudioFile(previous.file_name);

    upsertQQMusicAudioCache({
      mid,
      fileName,
      mime: format.mime,
      bytes: size,
      etag: crypto.createHash("sha1").update(`${size}:${fs.statSync(destination).mtimeMs}`).digest("base64url"),
    });
    return true;
  } finally {
    stream.destroy();
    try {
      fs.unlinkSync(temporary);
    } catch {
      // 成功路径上 rename 已经消费了临时文件。
    }
  }
}

/* ------------------------------ 预热调度 ------------------------------ */

const warmTasks = new Map<string, Promise<boolean>>();
const warmWaiters: Array<() => void> = [];
let activeWarmCount = 0;

async function acquireWarmSlot(): Promise<void> {
  while (activeWarmCount >= MAX_WARM_CONCURRENCY) {
    await new Promise<void>((resolve) => warmWaiters.push(resolve));
  }
  activeWarmCount += 1;
}

function releaseWarmSlot(): void {
  activeWarmCount = Math.max(0, activeWarmCount - 1);
  warmWaiters.shift()?.();
}

/** 立即下载并等待完成；供测试与显式预热使用。 */
export async function warmAudioCache(mid: string, purl: string): Promise<boolean> {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid) || !/^https:\/\//i.test(purl)) return false;
  await acquireWarmSlot();
  try {
    return await downloadAudioToCache(normalizedMid, purl);
  } catch {
    return false;
  } finally {
    releaseWarmSlot();
  }
}

/**
 * 播放解析成功后的后台预热（fire-and-forget）。
 *
 * 不阻塞本次响应、不占用播放解析的限流额度；同一首歌只下载一次，之后一直作为
 * 授权失效时的降级副本，因此不会因为每次播放而反复消耗带宽。
 */
export function scheduleAudioCacheWarm(mid: string, purl: string): void {
  if (!qqMusicAudioCacheEnabled()) return;
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid) || !/^https:\/\//i.test(purl)) return;
  if (warmTasks.has(normalizedMid)) return;
  // 已经有可用副本就不再重复下载；降级副本只需要存在一份。
  if (getQQMusicAudioCache(normalizedMid)) return;
  if (warmTasks.size >= MAX_WARM_QUEUE) return;

  const task = warmAudioCache(normalizedMid, purl)
    .catch(() => false)
    .finally(() => {
      warmTasks.delete(normalizedMid);
    });
  warmTasks.set(normalizedMid, task);
}

/** 等待所有进行中的预热结束；仅测试与优雅关闭使用。 */
export async function settleAudioCacheWarm(): Promise<void> {
  await Promise.allSettled([...warmTasks.values()]);
}

/* ------------------------------ 读取与回收 ------------------------------ */

export type CachedAudioFile = {
  absolutePath: string;
  mime: string;
  size: number;
  etag: string;
  lastModified: Date;
};

/** 解析可播放的缓存文件并刷新 LRU 时间戳；索引存在但文件丢失时返回 null。 */
export function openCachedAudioFile(mid: string): CachedAudioFile | null {
  const entry = getQQMusicAudioCache(mid);
  if (!entry) return null;
  const absolutePath = audioCacheAbsolutePath(entry.file_name);
  if (!absolutePath) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;
  touchQQMusicAudioCache(entry.mid);
  return {
    absolutePath,
    mime: entry.mime || "audio/mpeg",
    size: stat.size,
    etag: entry.etag ? `"${entry.etag}"` : `"${crypto.createHash("sha1").update(`${stat.size}:${stat.mtimeMs}`).digest("base64url")}"`,
    lastModified: stat.mtime,
  };
}

/** 缓存概况；供后台展示当前占用了多少磁盘、上限是多少。 */
export type QQMusicAudioCacheStats = {
  enabled: boolean;
  files: number;
  totalBytes: number;
  maxTotalBytes: number;
  maxFileBytes: number;
};

export function qqMusicAudioCacheStats(): QQMusicAudioCacheStats {
  const entries = listQQMusicAudioCache();
  return {
    enabled: qqMusicAudioCacheEnabled(),
    files: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0),
    maxTotalBytes: audioCacheMaxTotalBytes(),
    maxFileBytes: audioCacheMaxFileBytes(),
  };
}

/** 该歌曲是否已经有可用副本；降级判断与预热去重都依赖它。 */
export function hasCachedAudio(mid: string): boolean {
  const entry = getQQMusicAudioCache(mid);
  if (!entry) return false;
  const absolutePath = audioCacheAbsolutePath(entry.file_name);
  if (!absolutePath) return false;
  try {
    return fs.statSync(absolutePath).size > 0;
  } catch {
    return false;
  }
}

/**
 * 按文件名删除磁盘副本。
 *
 * 展示缓存清理会在返回前一并删掉音频索引行，之后就无法再按 mid 反查文件名，
 * 因此清理路径必须用这个接口，而不是 removeCachedAudio()。
 */
export function removeCachedAudioFiles(fileNames: readonly string[]): number {
  let removedFiles = 0;
  for (const name of fileNames) {
    if (removeAudioFile(name)) removedFiles += 1;
  }
  return removedFiles;
}

/** 删除指定歌曲的磁盘副本、索引与歌词缓存；仅在索引行仍然存在时可用。 */
export function removeCachedAudio(mids: readonly string[]): number {
  const normalized = mids.flatMap((mid) => (MID_PATTERN.test(mid.trim()) ? [mid.trim()] : []));
  if (normalized.length === 0) return 0;
  let removedFiles = 0;
  for (const mid of normalized) {
    const entry = getQQMusicAudioCache(mid);
    if (entry && removeAudioFile(entry.file_name)) removedFiles += 1;
  }
  deleteQQMusicAudioCache(normalized);
  deleteQQMusicLyricCache(normalized);
  return removedFiles;
}

export type QQMusicAudioCachePruneResult = {
  /** 因容量超限被淘汰的歌曲数。 */
  evicted: number;
  /** 磁盘上存在但索引里没有的孤儿文件数（上一次删除只清了数据库行）。 */
  orphanFiles: number;
  /** 索引存在但文件已丢失而被清理的条目数（例如数据卷回滚）。 */
  missingFiles: number;
  freedBytes: number;
  totalBytes: number;
};

/**
 * 容量与一致性回收，由 maintenance scheduler 周期调用。
 * 顺序很重要：先清孤儿文件，再清失效索引，最后按 LRU 淘汰到容量上限以内。
 */
export function pruneQQMusicAudioCache(): QQMusicAudioCachePruneResult {
  const directory = audioCacheDirectory();
  const entries = listQQMusicAudioCache();
  const knownFiles = new Set(entries.map((entry) => entry.file_name));
  const warmingMids = new Set(warmTasks.keys());
  let orphanFiles = 0;

  let names: string[] = [];
  try {
    names = fs.readdirSync(directory);
  } catch {
    // 目录尚未创建表示没有任何缓存，无需回收。
  }
  for (const name of names) {
    if (knownFiles.has(name)) continue;
    // 正在进行预热的歌曲不能被当成孤儿删除。
    if (warmingMids.has(name.slice(0, name.lastIndexOf(".")))) continue;
    if (removeAudioFile(name)) orphanFiles += 1;
  }

  const missing = entries.filter((entry) => {
    const absolute = audioCacheAbsolutePath(entry.file_name);
    if (!absolute) return true;
    try {
      return fs.statSync(absolute).size === 0;
    } catch {
      return true;
    }
  }).map((entry) => entry.mid);
  if (missing.length > 0) {
    deleteQQMusicAudioCache(missing);
    deleteQQMusicLyricCache(missing);
  }

  const budget = audioCacheMaxTotalBytes();
  const survivors = listQQMusicAudioCache();
  let total = survivors.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0);
  const evicted: string[] = [];
  let freedBytes = 0;
  for (const entry of survivors) {
    if (total <= budget) break;
    removeAudioFile(entry.file_name);
    evicted.push(entry.mid);
    total -= Math.max(0, entry.bytes);
    freedBytes += Math.max(0, entry.bytes);
  }
  if (evicted.length > 0) {
    deleteQQMusicAudioCache(evicted);
    deleteQQMusicLyricCache(evicted);
  }

  return {
    evicted: evicted.length,
    orphanFiles,
    missingFiles: missing.length,
    freedBytes: freedBytes,
    totalBytes: Math.max(0, total),
  };
}
