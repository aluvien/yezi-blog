import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import { getCachedSiteSettings } from "@/lib/server-data";
import { normalizeDarkMode, normalizeLayoutTheme, normalizePalette } from "@/lib/theme";
import { ViewportZoomLock } from "@/components/site/ViewportZoomLock";
import "./globals.css";
import "aplayer/dist/APlayer.min.css";

export async function generateMetadata(): Promise<Metadata> {
  const settings = getCachedSiteSettings();
  const siteName = settings.site_name?.trim() || site.name;
  const description = settings.site_subtitle?.trim() || site.description;
  return {
    metadataBase: new URL(site.url),
    title: {
      default: siteName,
      template: `%s · ${siteName}`,
    },
    description,
    icons: {
      icon: "/pwa-icon/192",
      apple: "/pwa-icon/192",
    },
    openGraph: {
      type: "website",
      siteName,
      title: siteName,
      description,
      locale: "zh_CN",
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light) and (max-width: 699px)", color: "#ffffff" },
    { media: "(prefers-color-scheme: light) and (min-width: 700px)", color: "#f7f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1d22" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteSettings = getCachedSiteSettings();
  const palette = normalizePalette(siteSettings.theme);
  const layoutTheme = normalizeLayoutTheme(siteSettings.layout_theme);
  const darkMode = normalizeDarkMode(siteSettings.dark_mode);
  // 主题初始化：读 cookie（用户手动切换）> 后台设置的默认值 > 系统偏好。
  // 放在 body 最前执行，首帧前生效避免闪烁；后台管理页固定浅色。
  const themeInitScript = `(function(){try{var m=${JSON.stringify(darkMode)};var c=document.cookie.match(/(?:^|; )theme_mode=([^;]+)/);var mode=c?decodeURIComponent(c[1]):m;if(location.pathname.indexOf("/admin")===0)mode="light";var dark=mode==="dark"||(mode==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",dark?"dark":"light");}catch(e){}})();`;
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      data-palette={palette}
      data-layout-theme={layoutTheme}
      // data-theme 由内联脚本在 React 接管前设置（避免闪烁），
      // 用 suppressHydrationWarning 让 React 跳过对该元素的属性比对，防止水合报错 #418
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        {/* 静态字体样式必须位于 head 内；作为 html/body 的同级节点会生成无效文档结构，
            React 在生产环境接管页面时会因此触发 hydration mismatch (#418)。 */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/fonts/chiron/css/vf.css" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ViewportZoomLock />
        {children}
      </body>
    </html>
  );
}
