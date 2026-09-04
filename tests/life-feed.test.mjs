import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-life-feed-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  db,
  createLifeEvent,
  createWork,
  registerGithubRepository,
  upsertReferenceLibrarySnapshot,
  setWorkRepositories,
  addReferenceRelation,
  listReferenceRelationCountsBulk,
  listLifeFeedPage,
  countLifeFeedItems,
} = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// 用可控的 occurred_at / registered_at 覆盖四类内容的排序语义时间。整个文件只 seed 一次
// （github.full_name / reference canonical 有唯一约束，重复 seed 会冲突）。
let seeded;
function seed() {
  if (seeded) return seeded;
  const eventOld = createLifeEvent({ title: "2002 起点", content: "", occurred_at: "2002-01-01", date_precision: "year" });
  const eventNew = createLifeEvent({ title: "2024 远行", content: "", occurred_at: "2024-05-01", date_precision: "month" });
  const work = createWork({ title: "作品", description: "", cover: null, link: "", sort_order: 0 });
  const repo = registerGithubRepository({ owner: "aluvien", name: "r", fullName: "aluvien/r", repoUrl: "https://github.com/aluvien/r" });
  // 手动改登记/收藏时间，避免依赖 now() 的实时值造成排序抖动。
  db.prepare("UPDATE works SET created_at = ? WHERE id = ?").run("2023-01-01T00:00:00.000Z", work.id);
  db.prepare("UPDATE github_repositories SET registered_at = ? WHERE id = ?").run("2021-01-01T00:00:00.000Z", repo.id);
  const ref = upsertReferenceLibrarySnapshot(
    { url: "https://example.com/x", canonicalUrl: "https://example.com/x", title: "引用", source: "s", author: "", publishedAt: "1990-01-01", cover: "", description: "", summary: "", keyPoints: [] },
  );
  db.prepare("UPDATE reference_library SET saved_at = ? WHERE id = ?").run("2022-06-01T00:00:00.000Z", ref.id);
  setWorkRepositories(work.id, [repo.id]);
  addReferenceRelation({ reference_id: ref.id, target_type: "work", target_id: work.id });
  addReferenceRelation({ reference_id: ref.id, target_type: "github_repository", target_id: repo.id });
  seeded = { eventOld, eventNew, work, repo, ref };
  return seeded;
}

test("counts every life-feed source as one combined stream", () => {
  const { eventOld } = seed();
  assert.ok(eventOld.id > 0);
  assert.equal(countLifeFeedItems(), 5, "2 生活节点 + 1 作品 + 1 仓库 + 1 引用");
});

test("orders by each type's business time and preserves hydrate order across pagination", () => {
  seed();
  // 期望按语义时间倒序：2024 event > 2023 work > 2022 ref > 2021 repo > 2002 event
  const all = listLifeFeedPage(50, 0);
  assert.deepEqual(all.map((item) => item.type), ["life_event", "work", "reference", "github_repository", "life_event"]);
  assert.deepEqual(all.map((item) => item.value.title || item.value.custom_title || item.value.name), ["2024 远行", "作品", "引用", "r", "2002 起点"]);

  // 分页切片不改变相对顺序：第一页取 2，第二页取 3，拼接等于全量。
  const page1 = listLifeFeedPage(2, 0).map((i) => `${i.type}:${i.id}`);
  const page2 = listLifeFeedPage(2, 2).map((i) => `${i.type}:${i.id}`);
  const page3 = listLifeFeedPage(2, 4).map((i) => `${i.type}:${i.id}`);
  assert.deepEqual([...page1, ...page2, ...page3], all.map((i) => `${i.type}:${i.id}`));
});

test("bulk hydrates reference relation counts without per-row queries", () => {
  const { ref } = seed();
  const counts = listReferenceRelationCountsBulk([ref.id]);
  const bucket = counts.get(ref.id);
  assert.deepEqual(bucket, { post: 0, life_event: 0, work: 1, github_repository: 1 });
  // 不存在的 id 返回零值桶而不是报错。
  const empty = listReferenceRelationCountsBulk([999999]);
  assert.deepEqual(empty.get(999999), { post: 0, life_event: 0, work: 0, github_repository: 0 });
});
