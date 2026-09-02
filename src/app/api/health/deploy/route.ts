import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db, LATEST_DB_SCHEMA_VERSION } from "@/lib/db";
import { deployedBuildCommit } from "@/lib/deploy-build";
import { getUploadDir } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 公开面只做只读健康检查（含 W_OK 权限探测，均为无副作用的系统调用）。
 * BEGIN IMMEDIATE 写事务探针只在部署时执行：deploy worker 生成一次性
 * token 注入候选进程环境，健康请求必须携带匹配的 x-deploy-probe-token，
 * 否则公网 GET 就能反复抢 SQLite 写锁。构建只读模式跳过事务（连接本身
 * 就是 readonly）。
 */
function writeProbe(probeAuthorized: boolean): string | null {
  try {
    const uploads = getUploadDir();
    // 目录尚不存在时要求父目录可写（首个上传会现场创建它）。
    fs.accessSync(fs.existsSync(uploads) ? uploads : path.dirname(uploads), fs.constants.W_OK);
  } catch {
    return "uploads_not_writable";
  }
  const dbFile = String(db.name);
  try {
    fs.accessSync(dbFile, fs.constants.W_OK);
    fs.accessSync(path.dirname(dbFile), fs.constants.W_OK);
  } catch {
    return "database_not_writable";
  }
  if (process.env.BLOG_BUILD_READONLY === "true") return null;
  if (!probeAuthorized) return null;
  try {
    db.exec("BEGIN IMMEDIATE; ROLLBACK;");
  } catch {
    return "database_transaction_failed";
  }
  return null;
}

function hasValidProbeToken(request: Request): boolean {
  const expected = process.env.DEPLOY_PROBE_TOKEN?.trim();
  const supplied = request.headers.get("x-deploy-probe-token")?.trim() ?? "";
  if (!expected || !supplied) return false;
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function GET(request: Request) {
  try {
    const schemaVersion = db.pragma("user_version", { simple: true });
    if (typeof schemaVersion !== "number" || schemaVersion > LATEST_DB_SCHEMA_VERSION) {
      return NextResponse.json({
        status: "error",
        reason: "unsupported_schema",
        schemaVersion,
        supportedSchemaVersion: LATEST_DB_SCHEMA_VERSION,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    db.prepare("SELECT 1 FROM posts LIMIT 1").get();
    db.prepare("SELECT count(*) AS count FROM fts_posts").get();
    const probeAuthorized = hasValidProbeToken(request);
    const writeFailure = writeProbe(probeAuthorized);
    if (writeFailure) {
      return NextResponse.json({
        status: "error",
        reason: writeFailure,
        schemaVersion,
        supportedSchemaVersion: LATEST_DB_SCHEMA_VERSION,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({
      status: "ok",
      commit: deployedBuildCommit(),
      schemaVersion,
      supportedSchemaVersion: LATEST_DB_SCHEMA_VERSION,
      writeProbe: process.env.BLOG_BUILD_READONLY === "true"
        ? "skipped_readonly"
        : probeAuthorized ? "passed" : "read_only_surface",
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
