export type SafeRasterImageMime =
  | "image/avif"
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/x-icon";

function matches(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);
}
function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** Detect only inert raster formats; SVG is deliberately excluded because it can contain active content. */
export function detectSafeRasterImageMime(bytes: Uint8Array): SafeRasterImageMime | null {
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (matches(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 40));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  return null;
}
