// 独立备份任务使用：让 Node 解析项目源码的路径别名和相对 TypeScript 模块。
// 1) 把 `@/` 路径别名映射到 src/；
// 2) 为相对 import 补 `.ts`/`.tsx` 扩展名（src 里 import 相对路径时不写扩展名，
//    Node ESM 需要显式扩展名，这里像 bundler 一样补齐）。
// Used only by the detached backup worker.
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
