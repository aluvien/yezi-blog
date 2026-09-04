import { apiJson, apiOptions, paginationMeta, parsePagination, publicGithubRepository } from "@/lib/api";
import { countGithubRepositories, listGithubRepositories } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const repositories = listGithubRepositories({ limit, offset: (page - 1) * limit });
  return apiJson({
    data: repositories.map(publicGithubRepository),
    meta: paginationMeta(page, limit, countGithubRepositories()),
  }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
