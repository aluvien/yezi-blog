import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db, LATEST_DB_SCHEMA_VERSION } from "@/lib/db";
import { deployedBuildCommit } from "@/lib/deploy-build";
import { getUploadDir } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 只读检查之外再验证“部署完成后还能写”：uploads 目录、数据库文件与所在目录
 * 必须可写（WAL 需要目录写权限），并跑一个立即回滚的写事务证明 SQLite 真正
 * 能拿到写锁。构建只读模式跳过事务（连接本身就是 readonly）。
 */
function writeProbe(): string | null {
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
  try {
    db.exec("BEGIN IMMEDIATE; ROLLBACK;");
  } catch {
    return "database_transaction_failed";
  }
  return null;
}

export function GET() {
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
    const writeFailure = writeProbe();
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
      writeProbe: process.env.BLOG_BUILD_READONLY === "true" ? "skipped_readonly" : "passed",
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
