import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const nativeQQMusicRuntimePackages = [
  "@yakult-green-tea/qq-music-api",
  "ws",
  "axios",
  "follow-redirects",
  "form-data",
  "asynckit",
  "combined-stream",
  "delayed-stream",
  "es-set-tostringtag",
  "es-errors",
  "get-intrinsic",
  "call-bind-apply-helpers",
  "function-bind",
  "es-define-property",
  "es-object-atoms",
  "get-proto",
  "dunder-proto",
  "gopd",
  "has-symbols",
  "hasown",
  "math-intrinsics",
  "has-tostringtag",
  "mime-types",
  "mime-db",
  "https-proxy-agent",
  "agent-base",
  "debug",
  "ms",
  "chalk",
  "ansi-styles",
  "color-convert",
  "color-name",
  "supports-color",
  "has-flag",
  "colors",
  "moment",
  "lodash.get",
] as const;
const configuredServerActionOrigins = [
  process.env.NEXT_PUBLIC_SITE_URL ?? "",
  ...(process.env.SERVER_ACTION_ALLOWED_ORIGINS ?? "").split(","),
].flatMap((value) => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return [new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host];
  } catch {
    return [];
  }
});
const serverActionAllowedOrigins = [...new Set(configuredServerActionOrigins)];

const nextConfig: NextConfig = {
  output: "standalone",
  // 本地上传图由 Next Image 按设备宽度按需缩放，首次请求后复用优化缓存。
  images: {
    deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    qualities: [72, 75],
    formats: ["image/avif", "image/webp"],
    // 附件管理允许在保持 URL 不变的前提下压缩图片，优化缓存不能无限期
    // 复用旧派生图；一分钟后重新验证源文件即可兼顾首屏速度与更新及时性。
    minimumCacheTTL: 60,
  },
  serverExternalPackages: ["better-sqlite3", "@yakult-green-tea/qq-music-api"],
  // 反代（nginx/tunnel）转发时 Host 可能变成 127.0.0.1，导致 Next 的
  // Server Actions 同源校验（origin vs host）失败、后台所有保存操作报
  // "Invalid Server Actions request"。显式放行站点域名。
  experimental: {
    // 文件本体最多 20 MiB，Route Handler 允许 1 MiB multipart 开销；
    // Proxy/Nginx 再留 1 MiB，并由 Nginx 在公开入口稳定返回 413。
    proxyClientMaxBodySize: "22mb",
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
      // 文章 Markdown 与引用快照可能略超默认 1MB；服务端 Action 仍会把正文
      // 严格限制在 1.5MB，额外空间仅用于 Action 序列化开销。
      bodySizeLimit: "2mb",
    },
  },
  // Turbopack 默认向上查找 workspace root；父目录存在 lockfile 时会被误判为根，
  // 导致 standalone 输出嵌套到 .next/standalone/yezi-blog/，start-standalone.mjs 找不到 server.js。
  // turbopack.root 只管模块解析范围，standalone 输出的文件追踪根目录由
  // outputFileTracingRoot 控制，两者都要锁定到本项目目录，输出才会扁平、不误追踪整个仓库。
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
  // 原生 QQ 音乐扫码只加载固定包内的 Node 登录模块，不导入会自行监听端口的
  // package root。动态绝对路径无法由 NFT 静态发现，因此显式带入 standalone。
  outputFileTracingIncludes: {
    "/*": nativeQQMusicRuntimePackages.map((packageName) => `node_modules/${packageName}/**/*`),
  },
  // sharp 的 NFT 追踪在 Turbopack 下会误把整个项目打进 standalone
  // （警告 "Encountered unexpected file in NFT list"）。排除非运行必需文件，
  // 避免把源码、本地数据库（data/blog.db）等打进部署产物。
  outputFileTracingExcludes: {
    "/": [
      "data/**",
      "src/**",
      "scripts/**",
      "deploy/**",
      "AGENTS.md",
      "CLAUDE.md",
      "Dockerfile",
      "README.md",
      "ecosystem.config.js",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "next.config.ts",
      "tsconfig.json",
      "tsconfig.tsbuildinfo",
    ],
  },
  webpack(config) {
    // This one dynamic require is intentional: importing the package root would
    // start a second HTTP server. Its exact runtime closure is pinned above and
    // exercised from the standalone output during release validation.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /qq-music-native-login\.ts$/,
        message: /Critical dependency: (?:the request of a dependency|require function)/,
      },
    ];
    return config;
  },
  // 允许通过开发机 IP 或绑定域名访问 HMR 与 Server Actions；
  // 否则页面能打开，但登录、评论等客户端交互会像“没有反应”。
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.31.31", "yezi.biaozhu.me", "yezi.me", "www.yezi.me"],
  // 历史经典版路径只保留兼容性；公开链接与站点地图统一使用内容语义稳定的
  // 规范地址。配置层重定向会在渲染前直接返回 HTTP 308。
  async redirects() {
    return [
      { source: "/essay/rss.xml", destination: "/rss.xml", permanent: true },
      { source: "/archive/rss.xml", destination: "/rss.xml", permanent: true },
      { source: "/essay/:slug", destination: "/posts/:slug", permanent: true },
      { source: "/archive/:slug", destination: "/posts/:slug", permanent: true },
      { source: "/essay", destination: "/posts", permanent: true },
      { source: "/bits", destination: "/moments", permanent: true },
      // 「小记」升级为聚合页 /life；作品成为其下的一类内容，旧地址永久跳转保留兼容。
      { source: "/works", destination: "/life?type=works", permanent: true },
      { source: "/memo", destination: "/life", permanent: true },
      { source: "/archive", destination: "/archives", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      // 动态页面由 Next 自己决定缓存策略；后台与写接口必须明确禁止中间层缓存。
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          // 后台“使用现在位置”需要浏览器定位授权；Permissions-Policy 解析
          // 按声明顺序覆盖同名特性，所以这条放在全局禁用之后，只对本页放开。
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
        ],
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        source: "/uploads/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=60, must-revalidate" }],
      },
      {
        source: "/fonts/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/pwa-icon/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
      {
        source: "/(rss.xml|manifest.webmanifest|sitemap.xml)",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" }],
      },
    ];
  },
};

export default nextConfig;
