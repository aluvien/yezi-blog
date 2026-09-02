import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-api-v1-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  createCategory,
  createPost,
  db,
  setSiteSettings,
  syncArticleReferences,
  upsertReferenceLibrarySnapshot,
} = await import("../src/lib/db.ts");
const { GET: apiRoot } = await import("../src/app/api/v1/route.ts");
const { GET: postsGet } = await import("../src/app/api/v1/posts/route.ts");
const { GET: postGet } = await import("../src/app/api/v1/posts/[slug]/route.ts");
const { GET: categoriesGet } = await import("../src/app/api/v1/categories/route.ts");
const { GET: tagsGet } = await import("../src/app/api/v1/tags/route.ts");
const { GET: siteGet } = await import("../src/app/api/v1/site/route.ts");
const { GET: referencesGet } = await import("../src/app/api/v1/references/route.ts");
const { GET: referenceCategoriesGet } = await import("../src/app/api/v1/reference-categories/route.ts");
const { POST: interactionsPost } = await import("../src/app/api/v1/interactions/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("v1 keeps the legacy full-post response while native feeds can request indexed filters and summaries", async () => {
  createCategory("工程");
  const matched = createPost({
    title: "移动端 API 设计",
    content: "这是只应在文章详情中下载的完整 Markdown 正文。".repeat(12),
    category: "工程",
    tags: ["iOS", "API"],
    status: "published",
  });
  createPost({ title: "不匹配的文章", content: "其他内容", category: "随笔", tags: ["生活"], status: "published" });
  createPost({ title: "草稿标签", content: "不可公开", category: "工程", tags: ["draft-only"], status: "draft" });

  const legacy = await postsGet(new Request("http://yezi.test/api/v1/posts?limit=50")).json();
  const legacyItem = legacy.data.find((item) => item.id === matched.id);
  assert.equal(legacyItem.content, matched.content, "不带 view 参数时必须保持现有完整正文返回");

  const responseWithVersion = postsGet(new Request("http://yezi.test/api/v1/posts?limit=1"));
  assert.equal(responseWithVersion.headers.get("x-api-version"), "v1", "客户端可据此识别兼容的 API 主版本");

  const filtered = await postsGet(new Request("http://yezi.test/api/v1/posts?category=%E5%B7%A5%E7%A8%8B&tag=ios&view=summary&limit=10")).json();
  assert.equal(filtered.meta.total, 1);
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0].id, matched.id);
  assert.equal("content" in filtered.data[0], false, "摘要视图不能重复传输整篇正文");
  assert.match(filtered.data[0].excerpt, /完整 Markdown/);
  assert.deepEqual(filtered.data[0].tags, ["iOS", "API"]);

  const categories = await categoriesGet().json();
  assert.equal(categories.data.find((item) => item.name === "工程")?.posts_count, 1, "分类计数只能包含已发布文章");

  const tags = await tagsGet(new Request("http://yezi.test/api/v1/tags?limit=50")).json();
  assert.ok(tags.data.some((item) => item.tag === "iOS" && item.count === 1));
  assert.equal(tags.data.some((item) => item.tag === "draft-only"), false, "草稿标签不得暴露");
});

test("v1 post details include only public reference snapshots required by native Markdown rendering", async () => {
  const post = createPost({ title: "含引用的文章", content: "!reference:示例", status: "published" });
  syncArticleReferences(post.id, [{
    url: "https://example.com/public-reference",
    canonicalUrl: "https://example.com/public-reference",
    title: "公开引用",
    source: "Example",
    author: "Author",
    publishedAt: "2026-08-18",
    cover: "https://example.com/cover.jpg",
    description: "公开描述",
    summary: "公开摘要",
    keyPoints: ["公开要点"],
  }]);

  const response = await postGet(new Request(`http://yezi.test/api/v1/posts/${post.slug}`), { params: Promise.resolve({ slug: post.slug }) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.references.length, 1);
  assert.equal(payload.data.references[0].title, "公开引用");
  assert.match(payload.data.references[0].cover_url, /^\/api\/article-references\/image\?/);
  assert.equal("reader_html" in payload.data.references[0], false);
  assert.equal("raw_path" in payload.data.references[0], false);
});

test("v1 exposes only public site configuration and reference-card data", async () => {
  setSiteSettings({
    site_name: "叶子博客",
    site_subtitle: "写作与工程",
    site_logo: "/uploads/site-logo.png",
    author_name: "叶子",
    author_avatar: "/uploads/avatar.png",
    author_email: "private@example.com",
    about_content: "# 关于\n\n公开 Markdown 简介",
    social_links: "GitHub | https://github.com/aluvien",
    telegram_comment_notifications_enabled: "1",
    default_music: "qqvip:private:playlist",
    show_references_page: "1",
  });
  upsertReferenceLibrarySnapshot({
    url: "https://example.com/library-item",
    canonicalUrl: "https://example.com/library-item",
    title: "公开收藏",
    source: "Example",
    author: "作者",
    publishedAt: "2026-08-18",
    cover: "https://example.com/library-cover.jpg",
    description: "描述",
    summary: "摘要",
    keyPoints: ["要点"],
  }, { category: "阅读", tags: ["iOS", "架构"] });

  const root = await apiRoot().json();
  assert.equal(root.endpoints.site, "/api/v1/site");
  assert.equal(root.endpoints.references, "/api/v1/references");

  const site = await siteGet().json();
  assert.equal(site.data.name, "叶子博客");
  assert.equal(site.data.author.name, "叶子");
  assert.equal(site.data.author.avatar, "/uploads/avatar.png");
  assert.ok(site.data.navigation.some((item) => item.href === "/references"));
  const siteJson = JSON.stringify(site.data);
  assert.equal(siteJson.includes("private@example.com"), false);
  assert.equal(siteJson.includes("qqvip:private"), false);
  assert.equal(siteJson.includes("telegram_comment_notifications_enabled"), false);

  const references = await referencesGet(new Request("http://yezi.test/api/v1/references?category=%E9%98%85%E8%AF%BB&limit=10")).json();
  assert.equal(references.meta.total, 1);
  assert.equal(references.data[0].title, "公开收藏");
  assert.deepEqual(references.data[0].tags, ["iOS", "架构"]);
  assert.match(references.data[0].cover_url, /^\/api\/article-references\/image\?/);
  assert.equal("archive_cache_report" in references.data[0], false);
  assert.equal("linked_post_titles" in references.data[0], false);

  const referenceCategories = await referenceCategoriesGet().json();
  assert.deepEqual(referenceCategories.data, [{ category: "阅读", count: 1 }]);
});

test("native visitor UUIDs deduplicate interactions per installation without weakening the rate-limit key", async () => {
  const post = createPost({ title: "互动测试", content: "公开互动内容", status: "published" });
  const interact = (visitorId) => interactionsPost(new Request("http://yezi.test/api/v1/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "YeziBlog/1.0",
      "x-yezi-visitor-id": visitorId,
    },
    body: JSON.stringify({ target_type: "post", target_id: post.id, kind: "like" }),
  }));

  const first = await (await interact("9a3c22ec-b9e2-4a99-8842-4e11b2b1391c")).json();
  const second = await (await interact("511acfb5-65ca-4c6b-a076-cb02e19a0fa6")).json();
  assert.equal(first.data.liked, true);
  assert.equal(second.data.liked, true, "同一网络下不同 App 安装应可独立点赞");
  assert.equal(second.data.likes, 2);

  const toggle = await (await interact("9a3c22ec-b9e2-4a99-8842-4e11b2b1391c")).json();
  assert.equal(toggle.data.liked, false, "同一 Keychain UUID 仍应执行点赞切换");
  assert.equal(toggle.data.likes, 1);
});

test("public reference endpoints opt into short shared-cache TTLs while metric-bearing lists stay no-store", async () => {
  const tags = tagsGet(new Request("http://yezi.test/api/v1/tags?limit=50"));
  assert.match(tags.headers.get("cache-control"), /public, max-age=15, s-maxage=60, stale-while-revalidate=600/);
  const categories = await categoriesGet();
  assert.match(categories.headers.get("cache-control"), /s-maxage=60/);

  const posts = await postsGet(new Request("http://yezi.test/api/v1/posts?limit=5"));
  assert.equal(posts.headers.get("cache-control"), "no-store", "含实时 views/likes 的列表不得进入共享缓存");
});
