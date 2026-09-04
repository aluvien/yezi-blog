import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-github-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  db,
  registerGithubRepository,
  getGithubRepository,
  getGithubRepositoryByFullName,
  updateGithubRepositoryCustom,
  applyGithubSyncResult,
  markGithubSyncError,
  listGithubRepositories,
  countGithubRepositories,
  getGithubRepositoriesByIds,
  createWork,
  setWorkRepositories,
  listRepositoryIdsForWork,
  deleteGithubRepository,
} = await import("../src/lib/db.ts");

const { parseGithubRepositoryRef, githubRepositoryApiUrl } = await import("../src/lib/github-repository-url.ts");
const { normalizeGithubMetadata, fetchGithubRepositoryMetadata } = await import("../src/lib/github-api.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("parses GitHub refs and rejects non-repo or foreign-host inputs", () => {
  assert.deepEqual(
    parseGithubRepositoryRef("https://github.com/aluvien/yezi-blog"),
    { owner: "aluvien", name: "yezi-blog", fullName: "aluvien/yezi-blog", repoUrl: "https://github.com/aluvien/yezi-blog" },
  );
  assert.equal(parseGithubRepositoryRef("aluvien/yezi-blog").fullName, "aluvien/yezi-blog");
  assert.equal(parseGithubRepositoryRef("https://github.com/a/b.git").name, "b");
  assert.equal(parseGithubRepositoryRef("https://evil.com/a/b"), null, "非 github 主机必须拒绝");
  assert.equal(parseGithubRepositoryRef("https://github.com/a"), null, "缺少 repo 段");
  // 带 query 的仓库链接：pathname 仍是 /a/b，query 被忽略，owner/repo 正常解析。
  assert.equal(parseGithubRepositoryRef("https://github.com/a/b?utm_source=x").fullName, "a/b");
});

test("normalizes GitHub API payloads defensively", () => {
  assert.equal(normalizeGithubMetadata(null), null);
  assert.equal(normalizeGithubMetadata({}), null);
  const meta = normalizeGithubMetadata({
    full_name: "aluvien/yezi-blog",
    description: "Personal blog",
    homepage: "https://yezi.me",
    language: "TypeScript",
    topics: ["nextjs", "blog", "nextjs"],
    stargazers_count: 42,
    forks_count: 3,
    license: { spdx_id: "NOASSERTION" },
    default_branch: "main",
    archived: false,
    private: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    pushed_at: "2026-09-02T00:00:00Z",
  });
  assert.equal(meta.stars, 42);
  assert.equal(meta.license, "", "NOASSERTION 视为无许可证");
  // normalize 只做类型收敛；topics 去重发生在 DAO 写入层。
  assert.deepEqual(meta.topics, ["nextjs", "blog", "nextjs"]);
  assert.equal(meta.visibility, "public");
});

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

test("maps sync outcomes without ever surfacing the token", async () => {
  const ref = { owner: "aluvien", name: "yezi-blog", fullName: "aluvien/yezi-blog", repoUrl: "https://github.com/aluvien/yezi-blog" };
  const seenUrl = { current: "" };
  const stubFetch = (async (url) => {
    seenUrl.current = url;
    return jsonResponse(200, { full_name: "aluvien/yezi-blog", stargazers_count: 7, language: "TypeScript" });
  });
  const ok = await fetchGithubRepositoryMetadata(ref, stubFetch);
  assert.equal(ok.ok, true);
  assert.equal(ok.metadata.stars, 7);
  assert.equal(seenUrl.current, "https://api.github.com/repos/aluvien/yezi-blog", "只请求固定 api.github.com 路径");

  const rateLimited = await fetchGithubRepositoryMetadata(ref, async () => jsonResponse(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" }));
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.error, "rate_limited");

  const notFound = await fetchGithubRepositoryMetadata(ref, async () => jsonResponse(404, { message: "Not Found" }));
  assert.equal(notFound.error, "not_found");

  const network = await fetchGithubRepositoryMetadata(ref, async () => { throw new Error("boom"); });
  assert.equal(network.error, "network");
  // 任何失败信息里都不能出现被请求的 URL 之外的敏感串（token 从不进入返回值）。
  assert.ok(!JSON.stringify(notFound).includes("Bearer"));
});

test("sync writes auto fields but never overwrites curated custom fields", () => {
  const repo = registerGithubRepository({ owner: "aluvien", name: "blog", fullName: "aluvien/blog", repoUrl: "https://github.com/aluvien/blog", customTitle: "我的博客", tags: ["flagship"] });
  assert.equal(repo.sync_status, "idle");
  updateGithubRepositoryCustom(repo.id, { featured: true });

  applyGithubSyncResult(repo.id, {
    description: "desc from api", homepage: "", primary_language: "TypeScript", topics: ["a"],
    stars: 100, forks: 5, license: "MIT", default_branch: "main", archived: 0, visibility: "public",
    github_created_at: "", github_updated_at: "", pushed_at: "",
  });
  const synced = getGithubRepository(repo.id);
  assert.equal(synced.stars, 100, "自动字段被更新");
  assert.equal(synced.custom_title, "我的博客", "自定义标题不被覆盖");
  assert.equal(synced.featured, 1, "精选标记不被覆盖");
  assert.equal(synced.tags, '["flagship"]', "标签不被覆盖");
  assert.equal(synced.sync_status, "success");

  markGithubSyncError(repo.id, "网络错误");
  const errored = getGithubRepository(repo.id);
  assert.equal(errored.sync_status, "error");
  assert.equal(errored.stars, 100, "失败保留上次成功数据");
});

test("rejects duplicate full_name registration and cascades work relations on delete", () => {
  assert.throws(() => registerGithubRepository({ owner: "aluvien", name: "blog", fullName: "aluvien/blog", repoUrl: "https://github.com/aluvien/blog" }), /UNIQUE constraint/i);

  const work = createWork({ title: "W", description: "", cover: null, link: "", sort_order: 0 });
  const repoId = getGithubRepositoryByFullName("aluvien/blog").id;
  setWorkRepositories(work.id, [repoId, 999999]);
  assert.deepEqual(listRepositoryIdsForWork(work.id), [repoId], "只保留存在的仓库");
  assert.equal(countGithubRepositories(), 1);
  assert.equal(getGithubRepositoriesByIds([repoId]).size, 1);

  deleteGithubRepository(repoId);
  assert.deepEqual(listRepositoryIdsForWork(work.id), [], "删除仓库级联清除作品关联");
  assert.equal(listGithubRepositories().length, 0);
  void githubRepositoryApiUrl;
});
