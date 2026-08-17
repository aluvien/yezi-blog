import { apiJson, apiOptions } from "@/lib/api";
import { listReferenceLibraryCategories } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return apiJson({ data: listReferenceLibraryCategories() });
}

export function OPTIONS() {
  return apiOptions();
}
