import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-admin-bearer-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");
process.env.ADMIN_API_TOKEN = "bearer-only-token-with-more-than-thirty-two-characters";

const { createComment, createPost, db, getSiteSettings, listCategories, listWorks } = await import("../src/lib/db.ts");
const { POST: categoriesPost } = await import("../src/app/api/admin/v1/categories/route.ts");
const { POST: worksPost } = await import("../src/app/api/admin/v1/works/route.ts");
const { POST: postsPost } = await import("../src/app/api/admin/v1/posts/route.ts");
const { PATCH: commentPatch } = await import("../src/app/api/admin/v1/comments/[id]/route.ts");
const { PATCH: settingsPatch } = await import("../src/app/api/admin/v1/settings/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function bearerRequest(url, method, body) {
  return new Request(`https://yezi.test${url}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// 回归：Bearer 通过 API 鉴权后，路由曾调用只认 Cookie 的 Server Action，
// 导致 NEXT_REDIRECT 被吞成 500。路由必须改走无传输层鉴权的业务核心。
test("Bearer-only writes reach the business core instead of 500 via cookie-only actions", async () => {
  const categoryResponse = await categoriesPost(bearerRequest("/api/admin/v1/categories", "POST", { name: "Bearer 创建" }));
  assert.notEqual(categoryResponse.status, 500);
  assert.equal(categoryResponse.status, 200);
  const categoryBody = await categoryResponse.json();
  assert.equal(categoryBody.data.name, "Bearer 创建");
  assert.ok(listCategories().some((category) => category.name === "Bearer 创建"));

  const workResponse = await worksPost(bearerRequest("/api/admin/v1/works", "POST", {
    title: "Bearer 作品",
    description: "通过原生 API 创建",
    cover: null,
    link: "",
    sort_order: 1,
  }));
  assert.equal(workResponse.status, 200);
  assert.ok(listWorks({ limit: 50, offset: 0 }).some((work) => work.title === "Bearer 作品"));

  const postResponse = await postsPost(bearerRequest("/api/admin/v1/posts", "POST", {
    title: "Bearer 文章",
    slug: "",
    content: "通过原生 API 发布的正文",
    cover: null,
    category: "Bearer 创建",
    tags: [],
    attachmentIds: [],
    status: "published",
  }));
  assert.equal(postResponse.status, 200);
  const postBody = await postResponse.json();
  assert.equal(postBody.data.title, "Bearer 文章");

  const settingsResponse = await settingsPatch(bearerRequest("/api/admin/v1/settings", "PATCH", { site_subtitle: "Bearer 副标题" }));
  assert.equal(settingsResponse.status, 200);
  assert.equal(getSiteSettings().site_subtitle, "Bearer 副标题");
});

test("Bearer-only comment moderation completes the full write path", async () => {
  const post = createPost({ title: "待评论文章", content: "正文", category: "随笔", tags: [], status: "published" });
  const comment = createComment({ target_type: "post", target_id: post.id, nickname: "访客", content: "写得不错", ip: "127.0.0.1" });
  assert.equal(comment.status, "pending");

  const response = await commentPatch(bearerRequest(`/api/admin/v1/comments/${comment.id}`, "PATCH", { action: "approve" }), {
    params: Promise.resolve({ id: String(comment.id) }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.status, "approved");
});
