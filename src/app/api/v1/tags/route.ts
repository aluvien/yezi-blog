import { apiJson, apiOptions, parsePagination } from "@/lib/api";
import { listPublishedTags } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Published post tags only; draft-only taxonomy is never exposed to clients. */
export function GET(request: Request) {
  const { limit } = parsePagination(new URL(request.url).searchParams);
  return apiJson({ data: listPublishedTags(limit) }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
