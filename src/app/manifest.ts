import type { MetadataRoute } from "next";
import { getSiteSettings } from "@/lib/db";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const revalidate = 300;

export default function manifest(): MetadataRoute.Manifest {
  const siteName = getSiteSettings().site_name?.trim() || site.name;
  return {
    name: siteName,
    short_name: siteName,
    description: site.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "zh-CN",
    background_color: "#f7f7f9",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
