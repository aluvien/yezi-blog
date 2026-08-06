import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // 反代（nginx/tunnel）转发时 Host 可能变成 127.0.0.1，导致 Next 的
  // Server Actions 同源校验（origin vs host）失败、后台所有保存操作报
  // "Invalid Server Actions request"。显式放行站点域名。
  experimental: {
    serverActions: {
      allowedOrigins: ["yezi.biaozhu.me", "yezi.me", "www.yezi.me"],
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
  // 允许通过开发机 IP 或绑定域名访问 HMR 与 Server Actions；
  // 否则页面能打开，但登录、评论等客户端交互会像“没有反应”。
  allowedDevOrigins: ["192.168.31.31", "yezi.biaozhu.me", "yezi.me", "www.yezi.me"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTML / 动态页面防缓存：避免微信等内置浏览器缓存旧页面，确保改动即时可见
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // 带哈希的静态资源长缓存（后定义覆盖上面的 no-cache）
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/uploads/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
