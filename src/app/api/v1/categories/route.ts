import { apiJson, apiOptions } from "@/lib/api";
import { listCategoriesWithPublishedPostCount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return apiJson({ data: listCategoriesWithPublishedPostCount() }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
