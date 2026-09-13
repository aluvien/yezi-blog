/**
 * HTTP Range 解析。
 *
 * 音频播放必须支持分段请求：iOS Safari 对没有 206 / Accept-Ranges 的音频可能
 * 直接不出声，桌面端也会失去拖动进度条的能力。这里只处理单区间，因为播放器
 * 实际上只会发单区间；多区间语法按“忽略 Range、返回整文件”处理（HTTP 允许），
 * 只有语义上确实无法满足的区间才返回 unsatisfiable 交给调用方回 416。
 */

export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header || !Number.isFinite(size) || size <= 0) return null;
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-N` 表示最后 N 个字节。
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}
