import {
  adminActionError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
  readAdminJson,
  serializeAdminWork,
} from "@/lib/admin-api";
import { createWorkAction } from "@/lib/actions/works";
import { countWorks, getWork, listWorks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const works = listWorks({ limit: pagination.limit, offset: pagination.offset });
    return adminSuccess(
      works.map(serializeAdminWork),
      paginationMeta(pagination.page, pagination.limit, countWorks()),
    );
  } catch (error) {
    return adminInternalError("list works", error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;

  try {
    const result = await createWorkAction({
      title: body.value.title as string,
      description: body.value.description as string,
      cover: body.value.cover as string | null,
      link: body.value.link as string,
      sort_order: body.value.sort_order as number,
    });
    if (!result.ok) return adminActionError(result);
    const created = result.data;
    if (!created || typeof created !== "object" || !("id" in created) || typeof created.id !== "number") {
      return adminInternalError("create work response", new Error("created work is missing"));
    }
    const work = getWork(created.id);
    if (!work) return adminInternalError("create work response", new Error("created work is missing"));
    return adminSuccess(serializeAdminWork(work));
  } catch (error) {
    return adminInternalError("create work", error);
  }
}
