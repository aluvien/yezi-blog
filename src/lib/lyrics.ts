export interface LyricLine {
  time: number;
  text: string;
}

/** 解析常见 LRC 时间标签，支持同一行多个时间点。 */
export function parseLrc(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of content.replace(/\r/g, "").split("\n")) {
    const timeTags = [...rawLine.matchAll(/\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (timeTags.length === 0) continue;
    const text = rawLine.replace(/\[(\d{2,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "").trim();
    if (!text) continue;
    for (const tag of timeTags) {
      const minutes = Number.parseInt(tag[1], 10);
      const seconds = Number.parseInt(tag[2], 10);
      const fraction = tag[3] ? Number.parseInt(tag[3], 10) / (tag[3].length === 1 ? 10 : tag[3].length === 2 ? 100 : 1000) : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** 根据播放秒数获取当前歌词，没有命中时返回上一句或空字符串。 */
export function lyricAt(lines: LyricLine[], currentTime: number): string {
  let current = "";
  for (const line of lines) {
    if (line.time > currentTime) break;
    current = line.text;
  }
  return current;
}
