import { NextResponse } from "next/server";
import { db, LATEST_DB_SCHEMA_VERSION } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({
      status: "ok",
      commit: process.env.DEPLOY_BUILD_COMMIT || "development",
      schemaVersion,
      supportedSchemaVersion: LATEST_DB_SCHEMA_VERSION,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
