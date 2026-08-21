import { expect, test, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const password = "e2e-test-password";
const e2eRoot = path.join(os.tmpdir(), "yezi-blog-playwright");
const snapshot = {
  url: "https://example.com/ios-admin-reference",
  canonicalUrl: "https://example.com/ios-admin-reference",
  title: "iOS 管理引用",
  source: "Example",
  author: "Admin API",
  publishedAt: "2026-08-21",
  cover: "",
  description: "REST API 引用测试",
  summary: "测试摘要",
  keyPoints: ["要点一"],
};

async function login(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/admin/login", { data: { password } });
  expect(response.status()).toBe(200);
}

async function createPost(request: APIRequestContext, suffix: string, input: Record<string, unknown> = {}): Promise<number> {
  const response = await request.post("/api/admin/v1/posts", {
    data: {
      title: `iOS API ${suffix}`,
      slug: `ios-api-${suffix}`,
      content: "原生管理端测试正文。",
      cover: null,
      category: "",
      tags: "iOS, API",
      attachmentIds: [],
      referenceSnapshots: [],
      status: "draft",
      ...input,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data.id as number;
}

test.describe.serial("native admin REST API", () => {
  test("all added endpoints reject unauthenticated requests with the REST JSON envelope", async ({ request }) => {
    const checks: Array<[string, "get" | "post" | "patch" | "delete"]> = [
      ["/api/admin/v1/categories", "post"],
      ["/api/admin/v1/categories/1", "patch"],
      ["/api/admin/v1/categories/1", "delete"],
      ["/api/admin/v1/tags", "patch"],
      ["/api/admin/v1/tags", "delete"],
      ["/api/admin/v1/references", "get"],
      ["/api/admin/v1/references", "post"],
      ["/api/admin/v1/references/1", "get"],
      ["/api/admin/v1/references/1", "patch"],
      ["/api/admin/v1/references/1", "delete"],
      ["/api/admin/v1/references/bulk-delete", "post"],
      ["/api/admin/v1/posts/1/references", "post"],
      ["/api/admin/v1/attachments/1/compress", "post"],
      ["/api/admin/v1/attachments/untracked/compress", "post"],
      ["/api/admin/v1/attachments/untracked", "delete"],
      ["/api/admin/v1/attachments/cleanup-unused", "post"],
      ["/api/admin/v1/deploy/status", "get"],
      ["/api/admin/v1/deploy/version", "get"],
      ["/api/admin/v1/deploy/sync", "post"],
      ["/api/admin/v1/deploy/restart", "post"],
    ];
    for (const [url, method] of checks) {
      const response = await request.fetch(url, { method: method.toUpperCase() });
      expect(response.status(), `${method.toUpperCase()} ${url}`).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "未登录或登录已过期" } });
      expect(response.headers()["cache-control"]).toContain("private, no-store");
    }
  });

  test("creates, updates and deletes categories; renames and deletes tags", async ({ request }) => {
    await login(request);
    const created = await request.post("/api/admin/v1/categories", { data: { name: "iOS 分类" } });
    expect(created.status()).toBe(200);
    const category = (await created.json()).data;
    expect(category).toMatchObject({ name: "iOS 分类", posts_count: 0 });

    const updated = await request.patch(`/api/admin/v1/categories/${category.id}`, { data: { name: "iOS 分类更新" } });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).data.name).toBe("iOS 分类更新");
    const duplicate = await request.post("/api/admin/v1/categories", { data: { name: "iOS 分类更新" } });
    expect(duplicate.status()).toBe(400);
    const removed = await request.delete(`/api/admin/v1/categories/${category.id}`);
    expect(removed.status()).toBe(200);

    await createPost(request, "tags");
    const renamed = await request.patch("/api/admin/v1/tags", { data: { old_tag: "iOS", new_tag: "Swift" } });
    expect(renamed.status()).toBe(200);
    expect((await renamed.json()).data.tags).toEqual(expect.arrayContaining([{ tag: "Swift", count: 1 }]));
    const deleted = await request.delete("/api/admin/v1/tags", { data: { tag: "Swift" } });
    expect(deleted.status()).toBe(200);
    expect((await deleted.json()).data.tags.some((item: { tag: string }) => item.tag === "Swift")).toBe(false);
  });

  test("manages references and attaches a snapshot to a post", async ({ request }) => {
    await login(request);
    const created = await request.post("/api/admin/v1/references", { data: { snapshot, category: "工程", tags: "iOS, REST" } });
    expect(created.status()).toBe(200);
    const reference = (await created.json()).data;
    expect(reference).toMatchObject({ title: snapshot.title, category: "工程", tags: ["iOS", "REST"], linked_post_count: 0 });

    const listed = await request.get("/api/admin/v1/references?search=iOS&category=%E5%B7%A5%E7%A8%8B&tag=REST");
    expect(listed.status()).toBe(200);
    expect((await listed.json()).meta.total).toBeGreaterThanOrEqual(1);
    const updated = await request.patch(`/api/admin/v1/references/${reference.id}`, { data: { category: "阅读", tags: "Swift" } });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).data).toMatchObject({ category: "阅读", tags: ["Swift"] });

    const postId = await createPost(request, "reference-target");
    const attached = await request.post(`/api/admin/v1/posts/${postId}/references`, { data: { snapshot } });
    expect(attached.status()).toBe(200);
    expect((await attached.json()).data.referenceSnapshots).toHaveLength(1);

    const extra = await Promise.all(["bulk-a", "bulk-b"].map(async (suffix) => {
      const response = await request.post("/api/admin/v1/references", { data: { snapshot: { ...snapshot, url: `https://example.com/${suffix}`, canonicalUrl: `https://example.com/${suffix}` } } });
      expect(response.status()).toBe(200);
      return (await response.json()).data.id as number;
    }));
    const bulk = await request.post("/api/admin/v1/references/bulk-delete", { data: { ids: extra } });
    expect(bulk.status()).toBe(200);
    expect((await bulk.json()).data.deletedCount).toBe(2);
    const removed = await request.delete(`/api/admin/v1/references/${reference.id}`);
    expect(removed.status()).toBe(200);
  });

  test("maintains attachments without deleting referenced files or accepting path traversal", async ({ request }) => {
    await login(request);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#2176ff" } }).png().toBuffer();
    const usedUpload = await request.post("/api/admin/upload", {
      multipart: { file: { name: "used.png", mimeType: "image/png", buffer: image }, original: "true" },
    });
    expect(usedUpload.status()).toBe(200);
    const used = await usedUpload.json();
    await createPost(request, "attachment-used", { content: `![used](${used.path})`, attachmentIds: [used.attachment.id] });
    const compressed = await request.post(`/api/admin/v1/attachments/${used.attachment.id}/compress`, { data: { profile: "balanced" } });
    expect(compressed.status()).toBe(200);
    expect(await compressed.json()).toHaveProperty("data.originalSize");
    const protectedDelete = await request.delete(`/api/admin/v1/attachments/${used.attachment.id}`);
    expect(protectedDelete.status()).toBe(400);

    const unusedUpload = await request.post("/api/admin/upload", {
      multipart: { file: { name: "unused.png", mimeType: "image/png", buffer: image }, original: "true" },
    });
    expect(unusedUpload.status()).toBe(200);
    const cleanup = await request.post("/api/admin/v1/attachments/cleanup-unused", { data: { confirm: true } });
    expect(cleanup.status()).toBe(200);
    expect((await cleanup.json()).data.deletedCount).toBeGreaterThanOrEqual(1);

    const untrackedDir = path.join(e2eRoot, "data", "uploads", "manual");
    fs.mkdirSync(untrackedDir, { recursive: true });
    fs.writeFileSync(path.join(untrackedDir, "untracked.png"), image);
    const untrackedCompress = await request.post("/api/admin/v1/attachments/untracked/compress", { data: { path: "manual/untracked.png", profile: "small" } });
    expect(untrackedCompress.status()).toBe(200);
    expect(await untrackedCompress.json()).toHaveProperty("data.savedPercent");
    const traversal = await request.delete("/api/admin/v1/attachments/untracked", { data: { path: "../outside.png", confirm: true } });
    expect(traversal.status()).toBe(400);
    const untrackedDelete = await request.delete("/api/admin/v1/attachments/untracked", { data: { path: "manual/untracked.png", confirm: true } });
    expect(untrackedDelete.status()).toBe(200);
  });

  test("deploy endpoints do not accept client-supplied commands, paths or branches", async ({ request }) => {
    await login(request);
    const response = await request.post("/api/admin/v1/deploy/sync", {
      data: { command: "rm -rf /", projectPath: "/tmp", pm2Name: "anything", branch: "feature" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_PARAMETER" } });
  });
});
