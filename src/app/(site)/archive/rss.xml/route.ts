import { GET as getRss } from "@/app/rss.xml/route";

// 保留经典归档页使用的 RSS 地址，内容与站点根 RSS 完全一致。
export const runtime = "nodejs";
export const revalidate = 300;

export function GET() {
  return getRss();
}
