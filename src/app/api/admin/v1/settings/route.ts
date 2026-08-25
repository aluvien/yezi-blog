import {
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  readAdminJson,
} from "@/lib/admin-api";
import { updateSiteSettingsAction } from "@/lib/actions/settings";
import { getSiteSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  try {
    return adminSuccess(getSiteSettings());
  } catch (error) {
    return adminInternalError("get settings", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.value)) {
    if (typeof value !== "string") return adminError("INVALID_PARAMETER", `${key} 必须是字符串`, 400);
    values[key] = value;
  }

  try {
    const result = await updateSiteSettingsAction(values);
    if (!result.ok) return adminError("SETTINGS_UPDATE_FAILED", result.error, 400);
    return adminSuccess(getSiteSettings());
  } catch (error) {
    return adminInternalError("update settings", error);
  }
}
