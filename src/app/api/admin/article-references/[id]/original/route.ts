import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getArticleReferenceArchive, getReferenceLibraryItem } from "@/lib/db";
import { readArticleReferenceRawArchive } from "@/lib/article-reference-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdminApi()) return NextResponse.json({ error: "未登录" }, { status: 401, headers: { "cache-control": "no-store" } });
  const { id } = await params;
  const reference = getReferenceLibraryItem(Number(id));
  if (!reference) return NextResponse.json({ error: "引用不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
  const archive = getArticleReferenceArchive(reference.canonical_url);
  const raw = archive ? readArticleReferenceRawArchive(archive) : null;
  if (!raw) return NextResponse.json({ error: "未找到原始快照" }, { status: 404, headers: { "cache-control": "no-store" } });
  const bytes = new Uint8Array(raw.byteLength);
  bytes.set(raw);

  return new NextResponse(bytes, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="article-reference-${reference.id}.html"`,
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
