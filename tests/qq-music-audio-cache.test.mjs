import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-audio-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");

const {
  cleanupUnusedQQMusicCache,
  db,
  deleteQQMusicAudioCache,
  getQQMusicAudioCache,
  getQQMusicLyricCache,
  qqMusicAudioCacheTotalBytes,
  upsertQQMusicLyricCache,
  upsertQQMusicMetadata,
} = await import("../src/lib/db.ts");
const {
  audioCacheDirectory,
  hasCachedAudio,
  openCachedAudioFile,
  pruneQQMusicAudioCache,
  qqMusicAudioCacheEnabled,
  removeCachedAudio,
  removeCachedAudioFiles,
  scheduleAudioCacheWarm,
  settleAudioCacheWarm,
  warmAudioCache,
} = await import("../src/lib/qq-music-audio-cache.ts");
const { cachedMusicAudioUrl, qqMusicMidFromTrackKey } = await import("../src/lib/music.ts");
const { parseByteRange } = await import("../src/lib/byte-range.ts");

const originalFetch = globalThis.fetch;
const MID_A = "AudioCacheA001";
const MID_B = "AudioCacheB002";
const MID_C = "AudioCacheC003";

test.after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 伪造一次音频响应；url 决定格式推断走的扩展名分支。 */
function audioResponse(bytes, { contentType = "audio/mp4", status = 200, declaredLength = null } = {}) {
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "content-length") return String(declaredLength ?? bytes.byteLength);
        return null;
      },
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
  };
}

function purlFor(mid, extension = ".m4a") {
  return `https://dl.stream.qqmusic.qq.com/C400${mid}${extension}?vkey=test`;
}

function countFetches(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
  return calls;
}

test("a successful warm writes the audio bytes, index row and a usable file handle", async () => {
  const bytes = Buffer.from("fake-audio-payload-A".repeat(20));
  const calls = countFetches(() => audioResponse(bytes));

  assert.equal(await warmAudioCache(MID_A, purlFor(MID_A)), true);

  assert.equal(calls.length, 1);
  const entry = getQQMusicAudioCache(MID_A);
  assert.ok(entry, "索引行应写入");
  assert.equal(entry.file_name, `${MID_A}.m4a`);
  assert.equal(entry.mime, "audio/mp4");
  assert.equal(entry.bytes, bytes.byteLength);
  assert.match(entry.etag, /^[A-Za-z0-9_-]{20,}$/);

  assert.equal(hasCachedAudio(MID_A), true);
  const file = openCachedAudioFile(MID_A);
  assert.ok(file);
  assert.equal(file.size, bytes.byteLength);
  assert.equal(file.mime, "audio/mp4");
  assert.deepEqual(fs.readFileSync(file.absolutePath), bytes);

  // 预热请求绝不能携带登录 Cookie：purl 自带签名，发给第三方 CDN 只会扩大泄露面。
  globalThis.fetch = originalFetch;
});

test("the warm request never forwards the QQ login cookie or credentials", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(init ?? {});
    return audioResponse(Buffer.from("payload-for-header-check"));
  };

  assert.equal(await warmAudioCache(MID_C, purlFor(MID_C)), true);
  assert.equal(seen.length, 1);
  const init = seen[0];
  const headerNames = Object.keys(init.headers ?? {}).map((name) => name.toLowerCase());
  assert.equal(headerNames.includes("cookie"), false);
  assert.equal(headerNames.includes("x-custom-cookie"), false);
  // 默认的 fetch 凭据策略即可；显式 include 才危险。
  assert.notEqual(init.credentials, "include");
  globalThis.fetch = originalFetch;
});

test("non-audio responses are rejected instead of being stored as playable audio", async () => {
  const before = qqMusicAudioCacheTotalBytes();
  countFetches(() => audioResponse(Buffer.from('{"error":"cookie expired"}'), { contentType: "application/json" }));

  // 没有音频扩展名的 purl + JSON 响应 = QQ 的错误页，必须放弃缓存。
  assert.equal(await warmAudioCache("AudioCacheErr01", "https://u.y.qq.com/cgi-bin/musicu.fcg?format=json"), false);
  assert.equal(getQQMusicAudioCache("AudioCacheErr01"), null);
  assert.equal(qqMusicAudioCacheTotalBytes(), before);
  globalThis.fetch = originalFetch;
});

test("declared and actual oversize payloads are both refused", async () => {
  process.env.QQ_MUSIC_AUDIO_CACHE_MAX_FILE_MB = "0.001";
  try {
    // 通过 Content-Length 提前拒绝，不必真的读流。
    countFetches(() => audioResponse(Buffer.from("x"), { declaredLength: 5_000_000 }));
    assert.equal(await warmAudioCache("AudioCacheBig1", purlFor("AudioCacheBig1")), false);
    assert.equal(getQQMusicAudioCache("AudioCacheBig1"), null);

    // Content-Length 缺失或说谎时，按实际读取的字节数兜底。
    countFetches(() => audioResponse(Buffer.alloc(4_000), { declaredLength: 1 }));
    assert.equal(await warmAudioCache("AudioCacheBig2", purlFor("AudioCacheBig2")), false);
    assert.equal(getQQMusicAudioCache("AudioCacheBig2"), null);
    assert.equal(fs.existsSync(path.join(audioCacheDirectory(), "AudioCacheBig2.m4a")), false);
  } finally {
    delete process.env.QQ_MUSIC_AUDIO_CACHE_MAX_FILE_MB;
    globalThis.fetch = originalFetch;
  }
});

test("scheduled warming is skipped when disabled and when a copy already exists", async () => {
  const calls = countFetches(() => audioResponse(Buffer.from("second-payload-for-dedupe")));

  // 已经有副本（上一个用例写入的 MID_A）时不再重复下载。
  scheduleAudioCacheWarm(MID_A, purlFor(MID_A));
  await settleAudioCacheWarm();
  assert.equal(calls.length, 0);

  process.env.QQ_MUSIC_AUDIO_CACHE_ENABLED = "0";
  try {
    assert.equal(qqMusicAudioCacheEnabled(), false);
    scheduleAudioCacheWarm("AudioCacheOff01", purlFor("AudioCacheOff01"));
    await settleAudioCacheWarm();
    assert.equal(calls.length, 0);
    assert.equal(getQQMusicAudioCache("AudioCacheOff01"), null);
  } finally {
    delete process.env.QQ_MUSIC_AUDIO_CACHE_ENABLED;
    globalThis.fetch = originalFetch;
  }
});

test("removing a song clears its file, index row and cached lyric", async () => {
  upsertQQMusicLyricCache(MID_A, "[00:00.00]测试歌词");
  const file = openCachedAudioFile(MID_A);
  assert.ok(file);
  assert.equal(getQQMusicLyricCache(MID_A), "[00:00.00]测试歌词");

  assert.equal(removeCachedAudio([MID_A]), 1);
  assert.equal(fs.existsSync(file.absolutePath), false);
  assert.equal(getQQMusicAudioCache(MID_A), null);
  assert.equal(getQQMusicLyricCache(MID_A), null);
  assert.equal(hasCachedAudio(MID_A), false);
});

test("prune drops orphan files, stale index rows and evicts by least-recent use", async () => {
  // 准备两首大小相同的歌，并显式拉开 LRU 时间戳以保证淘汰顺序确定。
  countFetches(() => audioResponse(Buffer.alloc(800, 7)));
  assert.equal(await warmAudioCache(MID_A, purlFor(MID_A)), true);
  assert.equal(await warmAudioCache(MID_B, purlFor(MID_B)), true);
  globalThis.fetch = originalFetch;

  const stray = path.join(audioCacheDirectory(), "StrayOrphanFile.m4a");
  fs.writeFileSync(stray, Buffer.alloc(10, 1));

  const directory = audioCacheDirectory();
  const setHit = db.prepare("UPDATE qq_music_audio_cache SET last_hit_at = ? WHERE mid = ?");
  setHit.run("2020-01-01T00:00:00.000Z", MID_A);
  setHit.run("2030-01-01T00:00:00.000Z", MID_B);

  // 预算只够放一首：应淘汰最久未使用的 A，保留 B。
  process.env.QQ_MUSIC_AUDIO_CACHE_MAX_TOTAL_MB = String(1_000 / (1024 * 1024));
  try {
    const result = pruneQQMusicAudioCache();
    assert.equal(result.orphanFiles, 1);
    assert.equal(result.evicted, 1);
    assert.equal(fs.existsSync(stray), false);
    assert.equal(getQQMusicAudioCache(MID_A), null);
    assert.equal(fs.existsSync(path.join(directory, `${MID_A}.m4a`)), false);
    assert.ok(getQQMusicAudioCache(MID_B), "最近使用的副本必须保留");
    assert.equal(fs.existsSync(path.join(directory, `${MID_B}.m4a`)), true);
    assert.ok(result.totalBytes <= 1_000);
  } finally {
    delete process.env.QQ_MUSIC_AUDIO_CACHE_MAX_TOTAL_MB;
  }

  // 索引存在但文件被外部删掉（例如数据卷回滚）：回收时清掉失效索引。
  fs.unlinkSync(path.join(directory, `${MID_B}.m4a`));
  const second = pruneQQMusicAudioCache();
  assert.equal(second.missingFiles, 1);
  assert.equal(getQQMusicAudioCache(MID_B), null);
});

test("cleanup helpers reject malformed mids and never touch paths", () => {
  assert.equal(removeCachedAudio(["../../etc/passwd"]), 0);
  assert.equal(removeCachedAudio([]), 0);
  assert.equal(deleteQQMusicAudioCache(["not a valid mid!"]), 0);
  // 路径穿越的 file_name 即使被写进数据库也不能解析出目录外的文件。
  db.prepare("INSERT INTO qq_music_audio_cache (mid, file_name, mime, bytes, etag, created_at, last_hit_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("Traversal001", "../../../etc/hosts", "audio/mpeg", 1, "x", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
  assert.equal(openCachedAudioFile("Traversal001"), null);
  assert.equal(hasCachedAudio("Traversal001"), false);
  deleteQQMusicAudioCache(["Traversal001"]);
});

test("metadata cleanup reports the audio file names so the caller can delete them", async () => {
  // 回归用例：清理函数会在返回前删掉音频索引行，所以它必须把文件名一起带出来。
  // 早期实现只返回 mid，调用方再按 mid 反查文件名时已经查不到，磁盘文件会永远留下。
  const mid = "CleanupOrphan01";
  countFetches(() => audioResponse(Buffer.from("payload-for-cleanup-test")));
  assert.equal(await warmAudioCache(mid, purlFor(mid)), true);
  globalThis.fetch = originalFetch;
  upsertQQMusicMetadata([{ mid, name: "待清理", artist: "测试", cover: "" }]);

  const filePath = path.join(audioCacheDirectory(), `${mid}.m4a`);
  assert.equal(fs.existsSync(filePath), true);

  // 没有任何内容引用它，清理应同时汇报索引行与文件名。
  const result = cleanupUnusedQQMusicCache(new Set(), new Set());
  assert.equal(result.songs, 1);
  assert.deepEqual(result.removedSongIds, [mid]);
  assert.deepEqual(result.removedAudioFiles, [`${mid}.m4a`]);

  // 按文件名删除后磁盘上不应再有任何残留。
  assert.equal(removeCachedAudioFiles(result.removedAudioFiles), 1);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(hasCachedAudio(mid), false);
  // 再次删除同一个名字应当是幂等的空操作。
  assert.equal(removeCachedAudioFiles(result.removedAudioFiles), 0);
});

test("client helpers map track keys to the local fallback URL", () => {
  assert.equal(qqMusicMidFromTrackKey("qqvip:001QuJ1234567:song"), "");
  assert.equal(qqMusicMidFromTrackKey("qqvip:001QuJ1234567"), "001QuJ1234567");
  assert.equal(qqMusicMidFromTrackKey("snapshot:001QuJ1234567"), "");
  assert.equal(qqMusicMidFromTrackKey(""), "");
  assert.equal(qqMusicMidFromTrackKey(undefined), "");
  assert.equal(cachedMusicAudioUrl("001QuJ1234567"), "/api/music/qq?id=001QuJ1234567&type=audio");
  assert.equal(cachedMusicAudioUrl("A/B"), "/api/music/qq?id=A%2FB&type=audio");
});

test("Range parsing distinguishes satisfiable, ignorable and unsatisfiable requests", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
  // 结束位置越界要收敛到文件末尾，而不是回 416。
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  // 超出文件大小的后缀区间等价于整个文件。
  assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 });

  // 起点越界、空区间、非法后缀都是无法满足。
  assert.equal(parseByteRange("bytes=1000-1200", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=500-400", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=-0", 1000), "unsatisfiable");

  // 无 Range、多区间、语法错误、空文件都按“返回整文件”处理。
  assert.equal(parseByteRange(null, 1000), null);
  assert.equal(parseByteRange("bytes=0-10,20-30", 1000), null);
  assert.equal(parseByteRange("items=0-10", 1000), null);
  assert.equal(parseByteRange("bytes=", 1000), null);
  assert.equal(parseByteRange("bytes=0-10", 0), null);
});
