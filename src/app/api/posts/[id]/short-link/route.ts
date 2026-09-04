import { NextResponse } from "next/server";
import { getOrCreatePostShortLink, getPost } from "@/lib/db";
import { createSlidingWindowLimiter } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 短链接是幂等资源，但仍限制陌生来源反复触发写事务。
const allowShortLinkCreation = createSlidingWindowLimiter({ windowMs: 60 * 1000, maxRequests: 20, maxKeys: 2_000 });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  const post = getPost(id);
  if (!post || post.status !== "published") return NextResponse.json({ error: "文章不存在" }, { status: 404 });

  if (!allowShortLinkCreation(hashIp(getClientIp(request)))) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429, headers: { "cache-control": "no-store" } });
  }

  try {
    const shortLink = getOrCreatePostShortLink(post.id);
    return NextResponse.json({ code: shortLink.code, path: `/${shortLink.code}` }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "短链接生成失败，请稍后再试" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
