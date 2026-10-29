import { adminSuccess, authorizeAdminApi } from "@/lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  return adminSuccess({ supported: true });
}
