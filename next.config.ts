import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // 允许同一局域网内通过开发机 IP 访问 HMR 与 Server Actions；
  // 否则页面能打开，但登录、评论等客户端交互会像“没有反应”。
  allowedDevOrigins: ["192.168.31.31"],
};

export default nextConfig;
