import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  readAdminJson,
} from "@/lib/admin-api";
import { compressUntrackedAttachmentByPath } from "@/lib/admin/attachments";
import type { CompressionProfile } from "@/lib/actions/attachments";
import { parseUntrackedUploadPath } from "../_path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseProfile(value: unknown): CompressionProfile | null {
  return value === "balanced" || value === "quality" || value === "small" ? value : null;
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const path = parseUntrackedUploadPath(body.value.path);
  if (!path) return adminError("INVALID_PATH", "path 必须是 uploads 目录内的相对文件路径", 400);
  const profile = parseProfile(body.value.profile);
  if (!profile) return adminError("INVALID_PARAMETER", "profile 只能是 balanced、quality 或 small", 400);
  try {
    const result = await compressUntrackedAttachmentByPath(path, profile);
    if (!result.ok) return adminActionError(result, "UNTRACKED_ATTACHMENT_COMPRESS_FAILED");
    return adminSuccess({ path, ...(result.data as Record<string, unknown> | undefined) });
  } catch (error) {
    return adminInternalError("compress untracked attachment", error);
  }
}
