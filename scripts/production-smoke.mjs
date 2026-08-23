import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneServer = path.join(root, ".next", "standalone", "server.js");
if (!fs.existsSync(standaloneServer)) {
  throw new Error("未找到 standalone 构建产物；请先运行 npm run build");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("无法分配本地 smoke 端口");
  return address.port;
}

async function waitForResponse(url, childOutput) {
  let lastError = "服务尚未开始监听";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(250);
  }
  throw new Error(`standalone 服务启动超时：${lastError}\n${childOutput()}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  timeout.unref();
  await exited;
  clearTimeout(timeout);
}

const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-production-smoke-"));
const port = await reserveLoopbackPort();
const output = [];
const child = spawn(process.execPath, [path.join(root, "scripts", "start-standalone.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    BLOG_ROOT: smokeRoot,
    BLOG_DB_PATH: path.join(smokeRoot, "data", "blog.db"),
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    ADMIN_PASSWORD: "production-smoke-password",
    SESSION_COOKIE_SECURE: "false",
    TRUST_PROXY: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream?.on("data", (chunk) => {
    output.push(String(chunk));
    while (output.join("").length > 12_000) output.shift();
  });
}

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const page = await waitForResponse(`${baseUrl}/`, () => output.join(""));
  const csp = page.headers.get("content-security-policy") || "";
  if (!csp.includes("default-src 'self'")) throw new Error("standalone 响应缺少生产 CSP");
  if (csp.includes("script-src 'self' 'unsafe-inline'")) throw new Error("生产 CSP 仍允许任意内联脚本");
  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  if (!nonce) throw new Error("生产 CSP 缺少 per-request nonce");
  const pageHtml = await page.text();
  if (!pageHtml.includes(`nonce=\"${nonce}\"`)) throw new Error("页面主题脚本或框架脚本未携带 CSP nonce");

  const api = await waitForResponse(`${baseUrl}/api/v1/search?q=standalone-smoke`, () => output.join(""));
  const body = await api.json();
  if (!body || typeof body !== "object" || !Array.isArray(body.data) || !body.meta) {
    throw new Error("standalone 搜索接口返回格式异常");
  }

  // 分布式失败触发账户级保护后，正确密码仍必须能登录；否则任何访客都能把
  // 管理员锁在门外。每次使用不同可信代理 IP，避免先触发单 IP 保护。
  for (let index = 0; index < 25; index += 1) {
    await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${index + 1}` },
      body: JSON.stringify({ password: "wrong-password" }),
    });
  }
  const validLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.201" },
    body: JSON.stringify({ password: "production-smoke-password" }),
  });
  if (!validLogin.ok) throw new Error("全局登录保护错误地拒绝了正确密码");

  const discovery = await waitForResponse(`${baseUrl}/api/v1`, () => output.join(""));
  const discoveryBody = await discovery.json();
  if (discovery.headers.get("x-api-version") !== "v1" || discoveryBody?.endpoints?.site !== "/api/v1/site") {
    throw new Error("standalone App API 发现信息异常");
  }

  const site = await waitForResponse(`${baseUrl}/api/v1/site`, () => output.join(""));
  const siteBody = await site.json();
  if (!siteBody?.data || typeof siteBody.data.name !== "string" || !Array.isArray(siteBody.data.navigation)) {
    throw new Error("standalone App API 站点配置异常");
  }
  console.log(`production smoke passed: standalone + SQLite + FTS + CSP on ${baseUrl}`);
} finally {
  await stop(child);
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}
