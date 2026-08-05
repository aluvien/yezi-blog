import { apiJson, apiOptions } from "@/lib/api";
import { listCategories } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return apiJson({ data: listCategories() });
}

export function OPTIONS() {
  return apiOptions();
}
