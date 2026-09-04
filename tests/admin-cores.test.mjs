import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-cores-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { createComment, createPost, db, getSiteSettings, listCategories } = await import("../src/lib/db.ts");
const {
  createCategoryByName,
  deleteCategoryById,
  deleteTag,
  renameTag,
  updateCategoryById,
  updateSiteSettings,
} = await import("../src/lib/admin/settings.ts");
const {
  attachArticleReferenceToPost,
  createPostEntry,
  deletePostEntry,
  saveReferenceLibraryEntry,
  updatePostEntry,
} = await import("../src/lib/admin/posts.ts");
const { createWorkEntry, deleteWorkEntry, updateWorkEntry } = await import("../src/lib/admin/works.ts");
const { createMomentEntry, deleteMomentEntry, updateMomentEntry } = await import("../src/lib/admin/moments.ts");
const { deleteReference, deleteReferenceMany, updateReferenceMetadata } = await import("../src/lib/admin/references.ts");
const { approveCommentById, deleteCommentById, hideCommentById, replyCommentById } = await import("../src/lib/admin/comments.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("updateSiteSettings preserves untouched keys, clamps values and normalizes enums", async () => {
  await updateSiteSettings({ site_name: "  核心站  ", music_position: "bottom", about_content: "  hello  " });
  let settings = getSiteSettings();
  assert.equal(settings.site_name, "核心站");
  assert.equal(settings.music_position, "bottom");
  assert.equal(settings.about_content, "hello");

  await updateSiteSettings({ site_name: "核心站", music_position: "nonsense", qq_music_health_check_enabled: "1", qq_music_health_check_interval_hours: "12" });
  settings = getSiteSettings();
  assert.equal(settings.music_position, "left", "非法 music_position 必须回退 left");
  assert.equal(settings.site_subtitle, "", "未提交的键保持原值");

  await updateSiteSettings({ site_name: "x".repeat(3_000) });
  assert.equal(getSiteSettings().site_name.length, 2_000, "超长值必须截断");
  assert.equal(listCategories().length, 0);
});

test("category core validates names, duplicates and existence on every mutation", async () => {
  assert.equal((await createCategoryByName("  ")).error, "分类名称不能为空且不超过 80 个字符");
  assert.equal((await createCategoryByName("名".repeat(81))).error, "分类名称不能为空且不超过 80 个字符");
  const created = await createCategoryByName("核心分类");
  assert.equal(created.ok, true);
  assert.equal((await createCategoryByName("核心分类")).error, "分类名称已经被使用");

  const id = created.data.id;
  assert.equal((await updateCategoryById(0, "新名")).error, "分类不存在");
  assert.equal((await updateCategoryById(id, "")).error, "分类名称不能为空且不超过 80 个字符");
  assert.equal((await updateCategoryById(9999, "新名")).error, "分类不存在");
  await createCategoryByName("占位分类");
  assert.equal((await updateCategoryById(id, "占位分类")).error, "分类名称已经被使用");
  assert.equal((await updateCategoryById(id, "改名成功")).ok, true);

  assert.equal((await deleteCategoryById(-1)).error, "分类不存在");
  assert.equal((await deleteCategoryById(9999)).error, "分类不存在");
  assert.equal((await deleteCategoryById(id)).ok, true);
});

test("tag core rejects invalid names and unknown tags before mutating", async () => {
  assert.equal((await renameTag("a,b", "c")).error, "标签不能为空、不能包含逗号，且不超过 80 个字符");
  assert.equal((await renameTag("  ", "ok")).error, "标签不能为空、不能包含逗号，且不超过 80 个字符");
  assert.equal((await renameTag("存在", "新标签")).error, "标签不存在");
  assert.equal((await deleteTag("x".repeat(81))).error, "标签名称无效");
  assert.equal((await deleteTag("不存在")).error, "标签不存在");

  createPost({ title: "带标签文章", content: "正文", category: "随笔", tags: ["旧标签"], status: "published" });
  assert.equal((await renameTag("#旧标签", "新标签")).ok, true);
  assert.equal((await deleteTag("新标签")).ok, true);
});

test("post core rejects malformed input on every documented bound", async () => {
  assert.equal((await createPostEntry(null)).error, "文章数据无效");
  assert.equal((await createPostEntry({})).error, "文章数据格式无效");
  const base = { title: "T", slug: "s", content: "c", cover: null, category: "", tags: "", attachmentIds: [], status: "published" };
  assert.equal((await createPostEntry({ ...base, title: "  " })).error, "请填写标题");
  assert.equal((await createPostEntry({ ...base, title: "标".repeat(241) })).error, "标题不能超过 240 个字符");
  assert.equal((await createPostEntry({ ...base, slug: "s".repeat(161) })).error, "Slug 不能超过 160 个字符");
  assert.equal((await createPostEntry({ ...base, content: "x".repeat(1_500_001) })).error, "文章正文过长，请控制在 150 万字符以内");
  assert.equal((await createPostEntry({ ...base, category: "类".repeat(81) })).error, "分类名称不能超过 80 个字符");
  assert.equal((await createPostEntry({ ...base, status: "archived" })).error, "文章状态无效");
  assert.equal((await createPostEntry({ ...base, status: "published", content: "  " })).error, "发布文章前请填写正文");
  assert.equal((await createPostEntry({ ...base, cover: "javascript:alert(1)" })).error, "封面地址无效");
  assert.equal((await createPostEntry({ ...base, attachmentIds: [0] })).error, "附件数据无效或数量过多");
  assert.equal((await createPostEntry({ ...base, attachmentIds: Array.from({ length: 101 }, (_, i) => i + 1) })).error, "附件数据无效或数量过多");
  assert.equal((await createPostEntry({ ...base, referenceSnapshots: Array.from({ length: 51 }, (_, i) => ({ url: `https://a.test/${i}` })) })).error, "文章引用不能超过 50 条");

  const created = await createPostEntry({ ...base, title: "核心文章", cover: "/uploads/a.png", category: "随笔", tags: "a, b" });
  assert.equal(created.ok, true);
  assert.equal((await updatePostEntry(0, base)).error, "文章不存在");
  assert.equal((await updatePostEntry(9999, base)).error, "文章不存在");
  const updated = await updatePostEntry(created.data.id, { ...base, title: "核心文章改", slug: created.data.slug });
  assert.equal(updated.ok, true);
  assert.equal((await deletePostEntry(9999)).error, "文章不存在");
  assert.equal((await deletePostEntry(created.data.id)).ok, true);
});

test("reference attach and library save validate snapshot shape and targets", async () => {
  assert.equal((await attachArticleReferenceToPost(0, { url: "https://a.test" })).error, "请选择一篇存在的文章");
  assert.equal((await attachArticleReferenceToPost(9999, { url: "https://a.test" })).error, "请选择一篇存在的文章");
  const post = createPost({ title: "引用宿主", content: "正文", category: "随笔", status: "published" });
  assert.equal((await attachArticleReferenceToPost(post.id, { url: "" })).error, "引用网址无效");
  const attached = await attachArticleReferenceToPost(post.id, { url: "https://example.test/post", title: "示例引用" });
  assert.equal(attached.ok, true);
  const again = await attachArticleReferenceToPost(post.id, { url: "https://example.test/post", title: "示例引用改名" });
  assert.equal(again.ok, true, "重复引用应替换而非报错");
  assert.equal((await attachArticleReferenceToPost(post.id, { url: "https://example.test/post", title: "示例引用改名" })).ok, true);

  assert.equal((await saveReferenceLibraryEntry({ url: "" })).error, "引用网址无效");
  assert.equal((await saveReferenceLibraryEntry({ url: "https://example.test/x" }, "类".repeat(81))).error, "分类名称不能超过 80 个字符");
  const saved = await saveReferenceLibraryEntry({ url: "https://example.test/y", title: "库引用" }, "资源", "tag-a");
  assert.equal(saved.ok, true);
});

test("work core enforces format, url and sort bounds", async () => {
  assert.equal((await createWorkEntry({})).error, "作品数据格式无效");
  const base = { title: "W", description: "d", cover: null, link: "", sort_order: 0 };
  assert.equal((await createWorkEntry({ ...base, title: " " })).error, "请填写标题");
  assert.equal((await createWorkEntry({ ...base, title: "标".repeat(241) })).error, "标题不能超过 240 个字符");
  assert.equal((await createWorkEntry({ ...base, description: "d".repeat(5_001) })).error, "作品介绍不能超过 5000 个字符");
  assert.equal((await createWorkEntry({ ...base, link: "ftp://x.test" })).error, "作品链接必须是有效的 http/https 地址");
  assert.equal((await createWorkEntry({ ...base, cover: "javascript:alert(1)" })).error, "封面地址无效");
  assert.equal((await createWorkEntry({ ...base, sort_order: 2_000_000 })).error, "排序值无效");

  const created = await createWorkEntry({ ...base, link: "https://x.test", cover: "/uploads/c.png", sort_order: 1.9 });
  assert.equal(created.ok, true);
  assert.equal((await updateWorkEntry(created.data.id, { ...base, title: " " })).error, "请填写标题");
  assert.equal((await updateWorkEntry(9999, base)).error, "作品不存在");
  assert.equal((await updateWorkEntry(created.data.id, base)).ok, true);
  assert.equal((await deleteWorkEntry(9999)).error, "作品不存在");
  assert.equal((await deleteWorkEntry(created.data.id)).ok, true);
});

test("moment core enforces content, image, location and non-empty rules", async () => {
  assert.equal((await createMomentEntry({ content: 1, images: [] })).error, "絮语数据格式无效");
  assert.equal((await createMomentEntry({ content: "字".repeat(20_001), images: [] })).error, "絮语内容不能超过 2 万个字符");
  assert.equal((await createMomentEntry({ content: "x", images: ["not-a-url"] })).error, "图片地址无效或数量超过 9 张");
  assert.equal((await createMomentEntry({ content: "x", images: Array.from({ length: 10 }, (_, i) => `/uploads/${i}.png`) })).error, "图片地址无效或数量超过 9 张");
  assert.equal((await createMomentEntry({ content: "x", images: [], location: "城".repeat(81) })).error, "位置格式无效或超过 80 个字符");
  assert.equal((await createMomentEntry({ content: "  ", images: [] })).error, "写点什么或至少传一张图");

  const created = await createMomentEntry({ content: "第一条", images: ["/uploads/a.png"], tags: ["t"], location: "杭州市" });
  assert.equal(created.ok, true);
  assert.equal((await updateMomentEntry(0, { content: "x", images: [] })).error, "絮语数据格式无效");
  assert.equal((await updateMomentEntry(created.data.id, { content: "  ", images: [] })).error, "写点什么或至少保留一张图");
  assert.equal((await updateMomentEntry(9999, { content: "x", images: [] })).error, "絮语不存在");
  const partial = await updateMomentEntry(created.data.id, { content: "更新", images: [] });
  assert.equal(partial.ok, true, "未提供 tags/location 时应保留原值");
  assert.equal((await deleteMomentEntry(9999)).error, "絮语不存在");
  assert.equal((await deleteMomentEntry(created.data.id)).ok, true);
});

test("reference library core guards ids, batch bounds and missing rows", async () => {
  assert.equal((await updateReferenceMetadata(0, "", "")).ok, false);
  assert.equal((await updateReferenceMetadata(1, "类".repeat(81), "")).ok, false);
  assert.equal((await updateReferenceMetadata(9999, "分类", "t")).error, "引用不存在");
  assert.equal((await deleteReference(-5)).error, "引用不存在");
  assert.equal((await deleteReference(9999)).error, "引用不存在或已被删除");
  assert.equal((await deleteReferenceMany([])).error, "请选择有效的引用");
  assert.equal((await deleteReferenceMany([1, 0])).error, "请选择有效的引用");
  assert.equal((await deleteReferenceMany(Array.from({ length: 101 }, (_, i) => i + 1))).error, "请选择有效的引用");
  assert.equal((await deleteReferenceMany([9998, 9999])).error, "选中的引用不存在或已被删除");

  const saved = await saveReferenceLibraryEntry({ url: "https://example.test/z", title: "可删引用" });
  const id = saved.data.id;
  assert.equal((await updateReferenceMetadata(id, "整理分类", "a, b")).ok, true);
  assert.equal((await deleteReference(id)).ok, true);
});

test("comment core returns not-found for unknown ids and mutates real rows", async () => {
  assert.equal((await approveCommentById(9999)).error, "评论不存在");
  assert.equal((await hideCommentById(9999)).error, "评论不存在");
  assert.equal((await deleteCommentById(9999)).error, "评论不存在");
  assert.equal((await replyCommentById(9999, "x")).error, "评论不存在");

  const post = createPost({ title: "评论宿主", content: "正文", category: "随笔", status: "published" });
  const comment = createComment({ target_type: "post", target_id: post.id, nickname: "访客", content: "评论", ip: "127.0.0.1" });
  assert.equal((await replyCommentById(comment.id, "回".repeat(1_001))).error, "回复不能超过 1000 字");
  assert.equal((await replyCommentById(comment.id, "  ")).ok, true);
  assert.equal((await approveCommentById(comment.id)).ok, true);
  assert.equal((await hideCommentById(comment.id)).ok, true);
  assert.equal((await deleteCommentById(comment.id)).ok, true);
});
