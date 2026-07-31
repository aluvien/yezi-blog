import { submitComment } from "@/lib/comment-api";
import { apiJson, apiOptions } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await submitComment(request);
  return apiJson(result.data, result.status);
}

export function OPTIONS() {
  return apiOptions();
}
