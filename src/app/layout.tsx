import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import { getSiteSettings } from "@/lib/db";
import { normalizeDarkMode, normalizeLayoutTheme, normalizePalette } from "@/lib/theme";
import "./globals.css";
import "aplayer/dist/APlayer.min.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.name,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  icons: {
    icon: "/pwa-icon/192",
    apple: "/pwa-icon/192",
  },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.name,
    description: site.description,
    locale: "zh_CN",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(max-width: 699px)", color: "#ffffff" },
    { media: "(min-width: 700px)", color: "#f7f7f9" },
  ],
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteSettings = getSiteSettings();
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
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/fonts/chiron/css/vf.css" />
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        {/* 禁用手机双指缩放：viewport meta 对 iOS Safari 无效，需拦截手势事件 */}
        <script dangerouslySetInnerHTML={{ __html: "document.addEventListener('gesturestart',function(e){e.preventDefault()},{passive:false});document.addEventListener('touchmove',function(e){if(e.touches.length>1)e.preventDefault()},{passive:false});" }} />
      </body>
    </html>
  );
}
