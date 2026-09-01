import { parseMusicSpec, type MusicSpec } from "@/lib/music";
import { parseVideoSpec, type VideoSpec } from "@/lib/video";

export type MediaShortcode =
  | { kind: "music"; spec: MusicSpec; value: string }
  | { kind: "video"; spec: VideoSpec; value: string };

function serializeMusicSpec(spec: MusicSpec): string {
  return `${spec.server}:${spec.id}:${spec.type}${spec.shuffle ? ":random" : ""}${spec.folded ? ":fold" : ""}`;
}

export function serializeVideoSpec(spec: VideoSpec): string {
  return `${spec.platform}:${spec.id}${spec.page && spec.page > 1 ? `:${spec.page}` : ""}`;
}

/** Parse a complete `!music` or `!video` line and return its canonical short form. */
export function parseMediaShortcodeLine(line: string): MediaShortcode | null {
  const match = line.match(/^\s*!(music|video)\s+(.+?)\s*$/i);
  if (!match) return null;
  if (match[1].toLowerCase() === "music") {
    const spec = parseMusicSpec(match[2]);
    return spec ? { kind: "music", spec, value: serializeMusicSpec(spec) } : null;
  }
  const spec = parseVideoSpec(match[2]);
  return spec ? { kind: "video", spec, value: serializeVideoSpec(spec) } : null;
}

function mapOutsideFencedCode(content: string, mapLine: (line: string, index: number, lines: string[]) => string[]): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      output.push(line);
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      output.push(line);
      fence = { character: marker[1][0] as "`" | "~", length: marker[1].length };
      continue;
    }
    output.push(...mapLine(line, index, lines));
  }
  return output.join("\n");
}

/**
 * Store valid media markers in one compact, stable form.  This accepts old
 * full provider URLs too, so API callers and pasted text cannot reintroduce
 * long-form video links into saved Markdown.
 */
export function normalizeMediaShortcodes(content: string): string {
  return mapOutsideFencedCode(content, (line) => {
    const shortcode = parseMediaShortcodeLine(line);
    return shortcode ? [`!${shortcode.kind} ${shortcode.value}`] : [line];
  });
}

/**
 * Turn standalone shortcodes into fenced blocks before Markdown is tokenized.
 * Marked otherwise merges adjacent lines into one paragraph, unlike the
 * line-by-line renderer used by moments, and the shortcode is missed.
 */
export function expandMediaShortcodes(content: string): string {
  return mapOutsideFencedCode(content, (line, index, lines) => {
    const shortcode = parseMediaShortcodeLine(line);
    if (!shortcode) return [line];
    const before = index > 0 && lines[index - 1].trim() ? [""] : [];
    const after = index < lines.length - 1 && lines[index + 1].trim() ? [""] : [];
    return [...before, `\`\`\`${shortcode.kind}`, shortcode.value, "```", ...after];
  });
}
