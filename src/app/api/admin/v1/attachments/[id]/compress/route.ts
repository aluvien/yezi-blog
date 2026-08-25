import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  readAdminJson,
} from "@/lib/admin-api";
import { compressAttachmentAction, type CompressionProfile } from "@/lib/actions/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseProfile(value: unknown): CompressionProfile | null {
  return value === "balanced" || value === "quality" || value === "small" ? value : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = parseAdminId((await params).id);
  if (id === null) return adminError("INVALID_ID", "附件 ID 必须是正整数", 400);
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const profile = parseProfile(body.value.profile);
  if (!profile) return adminError("INVALID_PARAMETER", "profile 只能是 balanced、quality 或 small", 400);
  try {
    const result = await compressAttachmentAction(id, profile);
    if (!result.ok) return adminActionError(result, "ATTACHMENT_COMPRESS_FAILED");
    return adminSuccess(result.data ?? {});
  } catch (error) {
    return adminInternalError("compress attachment", error);
  }
}
