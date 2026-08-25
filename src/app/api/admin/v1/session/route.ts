import { authorizeAdminApi, adminSuccess } from "@/lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;

  return adminSuccess({
    authenticated: true,
    created_at: auth.session.created_at,
    expires_at: auth.session.expires_at,
  });
}
