import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const port = Number.parseInt(process.env.QQ_MUSIC_API_PORT || "3200", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("QQ_MUSIC_API_PORT 必须是 1 到 65535 之间的端口号");
}

// The upstream package starts immediately on all interfaces. Load it in its
// test mode instead, then explicitly bind the same Koa application to loopback.
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const { default: app } = require("@yakult-green-tea/qq-music-api");

if (previousNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = previousNodeEnv;
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`QQ Music API listening at http://127.0.0.1:${port}`);
});

const close = () => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
