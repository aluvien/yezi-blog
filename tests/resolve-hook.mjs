// 测试专用：让 node --experimental-strip-types 能解析项目的模块写法。
// 1) 把 `@/` 路径别名映射到 src/；
// 2) 为相对 import 补 `.ts`/`.tsx` 扩展名（src 里 import 相对路径时不写扩展名，
//    Node ESM 需要显式扩展名，这里像 bundler 一样补齐）。
// 只在 tests/ 与 npm test 脚本里使用，不影响应用运行。
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const projectSrc = path.resolve(import.meta.dirname, "..", "src");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/** 相对 import 无扩展名时按 bundler 规则补齐；找不到返回 null 交给默认解析。 */
function resolveRelative(specifier, parentUrl) {
  if (!parentUrl || !parentUrl.startsWith("file://")) return null;
  const target = path.resolve(path.dirname(fileURLToPath(parentUrl)), specifier);
  if (fs.existsSync(target)) return null;
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(target + ext)) return pathToFileURL(target + ext).href;
  }
  for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
    if (fs.existsSync(path.join(target, `index${ext}`))) return pathToFileURL(path.join(target, `index${ext}`)).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Route Handler 测试会直接加载 Next 的 ESM 模块；应用构建器可解析
  // `next/server`，而裸 Node ESM 需要显式入口文件。仅测试钩子处理此差异。
  if (specifier === "next/server" || specifier === "next/headers" || specifier === "next/navigation") {
    return nextResolve(`${specifier}.js`, context);
  }
  // 纯 Node 没有 Next 的请求上下文，真实 revalidatePath 会直接抛错；
  // 测试里用无副作用 stub 代替，让已鉴权 Route Handler 能完整跑通。
  if (specifier === "next/cache") {
    return { url: new URL("./stubs/next-cache.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    let mapped = path.join(projectSrc, specifier.slice(2));
    // `@/lib/db` 同时存在 db.ts 与 db/ 目录时，应与 Next 的解析一致，
    // 优先命中扩展名文件而不是把目录交给 Node loader。
    if (!fs.existsSync(mapped) || fs.statSync(mapped).isDirectory()) {
      for (const ext of [".ts", ".tsx", ".mts"]) {
        if (fs.existsSync(mapped + ext)) {
          mapped += ext;
          break;
        }
      }
    }
    return { url: pathToFileURL(mapped).href, shortCircuit: true };
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolveRelative(specifier, context.parentURL);
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
