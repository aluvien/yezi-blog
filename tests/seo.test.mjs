import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-seo-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "blog.db");
process.env.ADMIN_API_TOKEN = "seo-regression-token-with-at-least-thirty-two-characters";
const { db, createPost, updatePost, getPost, setSiteSettings } = await import("../src/lib/db.ts");
const { siteSearchDescription, postSearchDescription, siteStructuredData, postStructuredData, serializeJsonLd } = await import("../src/lib/seo.ts");
const { parsePostPage } = await import("../src/lib/post-pagination.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");
const { PATCH, GET } = await import("../src/app/api/admin/v1/posts/[id]/route.ts");
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("search descriptions fall back without changing content and schema uses only public fields", () => {
  const settings = { site_name: "示例博客", author_name: "作者", site_subtitle: "原来的副标题", seo_description: "独立搜索简介", author_email: "private@example.test", telegram_bot_token: "private-token" };
  assert.equal(siteSearchDescription(settings), "独立搜索简介");
  assert.equal(siteSearchDescription({ ...settings, seo_description: "" }), "原来的副标题");
  const post = createPost({ title: '</script><script>alert("x")</script>', content: "原始正文", seoDescription: "搜索摘要", cover: "/uploads/cover.jpg" });
  assert.equal(postSearchDescription(post), "搜索摘要");
  assert.equal(postSearchDescription({ ...post, seo_description: "" }), "原始正文");
  const graph = siteStructuredData(settings, "https://example.test");
  const article = postStructuredData(post, settings, "https://example.test");
  assert.equal(article.author["@id"], graph["@graph"][1]["@id"]);
  assert.equal(article.dateModified, post.updated_at);
  assert.equal(article.image[0], "https://example.test/uploads/cover.jpg");
  assert.equal(article.mainEntityOfPage["@id"], `https://example.test/posts/${post.slug}`);
  const encoded = serializeJsonLd({ ...graph, article });
  assert.ok(!encoded.includes("</script>"));
  assert.ok(!encoded.includes("private@example.test"));
  assert.ok(!encoded.includes("private-token"));
  assert.equal(JSON.parse(encoded).article.headline, post.title);
  assert.equal(getPost(post.id).content, "原始正文");
});

test("legacy DAO writes preserve search settings; explicit empty values reset them", () => {
  const post = createPost({ title: "兼容旧编辑器", content: "原正文", seoDescription: "独立摘要", seoNoindex: true });
  const updated = updatePost(post.id, { title: post.title, slug: post.slug, content: "新正文" });
  assert.equal(updated.seo_description, "独立摘要");
  assert.equal(updated.seo_noindex, 1);
  const reset = updatePost(post.id, { title: post.title, slug: post.slug, content: "新正文", seoDescription: "", seoNoindex: false });
  assert.equal(reset.seo_description, "");
  assert.equal(reset.seo_noindex, 0);
});

test("authenticated APIs preserve omitted search settings and reject invalid values", async () => {
  const post = createPost({ title: "App 兼容", content: "正文", seoDescription: "摘要", seoNoindex: true });
  const params = { params: Promise.resolve({ id: String(post.id) }) };
  const request = (body, auth = true) => new Request(`https://example.test/api/admin/v1/posts/${post.id}`, { method: "PATCH", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await PATCH(request({ content: "App 修改正文" }), params)).status, 200);
  const detail = await GET(new Request(`https://example.test/api/admin/v1/posts/${post.id}`, { headers: { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } }), params);
  const data = (await detail.json()).data;
  assert.equal(data.seoDescription, "摘要");
  assert.equal(data.seoNoindex, true);
  for (const body of [{ seoNoindex: "false" }, { seoDescription: "x".repeat(301) }, { seoDescription: null }]) assert.equal((await PATCH(request(body), params)).status, 400);
  assert.ok([401, 403].includes((await PATCH(request({ seoNoindex: false }, false), params)).status));
  assert.equal((await PATCH(request({ seoDescription: "", seoNoindex: false }), params)).status, 200);
  assert.equal(getPost(post.id).seo_noindex, 0);
});

test("sitemap includes the article index, excludes drafts and opted-out posts, and follows the configured domain", () => {
  setSiteSettings({ site_url: "https://example.test" });
  const published = createPost({ title: "公开文章", content: "正文" });
  const hidden = createPost({ title: "不收录", content: "正文", seoNoindex: true });
  const draft = createPost({ title: "草稿", content: "正文", status: "draft" });
  const urls = sitemap().map(item => item.url);
  assert.ok(urls.includes("https://example.test/posts"));
  assert.ok(urls.includes(`https://example.test/posts/${published.slug}`));
  assert.ok(!urls.includes(`https://example.test/posts/${hidden.slug}`));
  assert.ok(!urls.includes(`https://example.test/posts/${draft.slug}`));
  assert.ok(urls.every(url => url.startsWith("https://example.test")));
  assert.equal(getPost(hidden.id).status, "published");
});

test("pagination accepts safe positive integers and avoids unsafe database offsets", () => {
  assert.equal(parsePostPage("2"), 2);
  for (const invalid of [undefined, "0", "-1", "2oops", "1.5", "99999999999999999", ["2", "3"]]) assert.equal(parsePostPage(invalid), 1);
});
