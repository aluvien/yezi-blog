import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };

// PM2、宝塔和开发终端可能残留其他 bundler 标记。项目固定用 webpack，
// 子进程只保留一个明确选择，避免 “Multiple bundler flags set”。
for (const key of Object.keys(env)) {
  if (
    key.startsWith("__NEXT_PRIVATE_")
    || key === "TURBOPACK"
    || key.startsWith("TURBOPACK_")
    || key.startsWith("NEXT_TURBOPACK")
    || key === "NEXT_RSPACK"
    || key === "IS_TURBOPACK_TEST"
    || key === "IS_WEBPACK_TEST"
  ) delete env[key];
}

const databasePath = path.resolve(env.BLOG_DB_PATH || path.join(root, "data", "blog.db"));
env.BLOG_ROOT = env.BLOG_ROOT?.trim() || root;
env.BLOG_DB_PATH = databasePath;
// 已有数据库必定只读构建；全新安装没有数据库时允许 Next 首次创建空表，
// 这样 Docker/首次克隆仍能构建，而生产内容永远不会在 build 阶段迁移或清理。
if (fs.existsSync(databasePath)) env.BLOG_BUILD_READONLY = "true";
else delete env.BLOG_BUILD_READONLY;

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`无法启动 Next 构建：${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Next 构建被信号 ${signal} 中断`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
