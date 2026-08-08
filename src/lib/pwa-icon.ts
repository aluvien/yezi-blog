import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getSiteSettings } from "@/lib/db";
import { getUploadDir } from "@/lib/uploads";
import { getSiteAuthor } from "@/lib/site";

function fallbackIcon(): Buffer {
  const letter = getSiteAuthor(getSiteSettings()).charAt(0).toUpperCase();
  const safeLetter = letter.replace(/[&<>"']/g, "");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="72" fill="#17191f" />
      <text x="256" y="330" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="260" font-weight="700">${safeLetter}</text>
    </svg>
  `);
}

function configuredLogo(): Buffer | string {
  const logo = getSiteSettings().site_logo?.trim();
  if (!logo || !logo.startsWith("/uploads/")) return fallbackIcon();
  let relative: string;
  try {
    relative = decodeURIComponent(logo.slice("/uploads/".length).split("?")[0]);
  } catch {
    return fallbackIcon();
  }
  if (!relative || relative.includes("..")) return fallbackIcon();
  const root = getUploadDir();
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return fallbackIcon();
  return fs.readFileSync(absolute);
}

/** 生成与页头 Logo 同源的标准 PWA 图标，保留 PNG Logo 的透明背景。 */
export async function renderPwaIcon(size: number): Promise<Buffer> {
  return sharp(configuredLogo())
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
