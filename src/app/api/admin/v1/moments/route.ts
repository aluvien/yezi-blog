import {
  adminActionError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
  readAdminJson,
  serializeAdminMoment,
} from "@/lib/admin-api";
import { createMomentAction } from "@/lib/actions/moments";
import { countMoments, getContentMetricsBulk, getMoment, listMoments } from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const moments = listMoments({ limit: pagination.limit, offset: pagination.offset });
    const metrics = getContentMetricsBulk("moment", moments.map((moment) => moment.id));
    return adminSuccess(
      moments.map((moment) => serializeAdminMoment(moment, metrics.get(moment.id) ?? { views: 0, likes: 0 })),
      paginationMeta(pagination.page, pagination.limit, countMoments()),
    );
  } catch (error) {
    return adminInternalError("list moments", error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;

  try {
    const result = await createMomentAction({
      content: body.value.content as string,
      images: body.value.images as string[],
      tags: parsePostTags(typeof body.value.tags === "string" ? body.value.tags : JSON.stringify(body.value.tags ?? [])),
      location: body.value.location as string | undefined,
    });
    if (!result.ok) return adminActionError(result);
    const created = result.data;
    if (!created || typeof created !== "object" || !("id" in created) || typeof created.id !== "number") {
      return adminInternalError("create moment response", new Error("created moment is missing"));
    }
    const moment = getMoment(created.id);
    if (!moment) return adminInternalError("create moment response", new Error("created moment is missing"));
    return adminSuccess(serializeAdminMoment(moment));
  } catch (error) {
    return adminInternalError("create moment", error);
  }
}
