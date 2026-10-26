import { expect, test, type APIRequestContext } from "@playwright/test";

async function createPost(request: APIRequestContext, slug: string, extra: Record<string, unknown> = {}) {
  const response = await request.post("/api/admin/v1/posts", { data: {
    title: `SEO 验证 ${slug}`, slug, content: "这是保持原样的文章正文。", cover: null, category: "验证", tags: "",
    attachmentIds: [], status: "published", ...extra,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

test("search metadata is server-rendered, escaped and independent of visible content", async ({ page }) => {
  expect((await page.request.post("/api/admin/login", { data: { password: "e2e-test-password" } })).ok()).toBe(true);
  const originalSettings = (await (await page.request.get("/api/admin/v1/settings")).json()).data;
  const ids: number[] = [];
  try {
    const post = await createPost(page.request, `seo-${Date.now()}`, { title: "搜索设置验证 </script><script>window.seoInjected=1</script>" });
    ids.push(post.id);
    await page.goto(`/admin/posts/${post.id}/edit`);
    await page.getByLabel("文章搜索摘要").fill("只用于搜索的独立摘要");
    await page.getByRole("button", { name: /保存/ }).filter({ hasNotText: "草稿" }).first().click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    const origin = new URL(page.url()).origin;
    const response = await page.request.get(`/posts/${post.slug}`);
    const html = await response.text();
    expect(html).toContain("application/ld+json");
    expect(html).toContain("BlogPosting");
    expect(html).toContain('name="description" content="只用于搜索的独立摘要"');
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/posts/${post.slug}`);
    await expect(page.locator("h1")).toHaveText(post.title);
    await expect(page.locator(".classic-article-prose")).toHaveText("这是保持原样的文章正文。");
    expect(await page.evaluate(() => "seoInjected" in window)).toBe(false);
    const article = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(node => JSON.parse(node.textContent || "{}")).find(value => value["@type"] === "BlogPosting"));
    expect(article.headline).toBe(post.title);
    expect(article.mainEntityOfPage["@id"]).toBe(`${origin}/posts/${post.slug}`);
    await page.goto("/");
    const visibleBefore = await page.locator("main").innerText();
    const settingsResponse = await page.request.patch("/api/admin/v1/settings", { data: { seo_description: "网站独立搜索介绍" } });
    expect(settingsResponse.ok()).toBe(true);
    await page.reload();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "网站独立搜索介绍");
    expect(await page.locator("main").innerText()).toBe(visibleBefore);
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(scripts.join(" ")).toContain("WebSite");
    expect(scripts.join(" ")).toContain("Person");
  } finally {
    for (const id of ids) await page.request.delete(`/api/admin/v1/posts/${id}`);
    await page.request.patch("/api/admin/v1/settings", { data: { seo_description: originalSettings.seo_description ?? "" } });
  }
});

test("pagination and indexing rules keep public URLs accessible and drafts private", async ({ page }) => {
  expect((await page.request.post("/api/admin/login", { data: { password: "e2e-test-password" } })).ok()).toBe(true);
  const ids: number[] = [];
  try {
    for (let index = 0; index < 13; index++) ids.push((await createPost(page.request, `seo-page-${Date.now()}-${index}`)).id);
    const hidden = await createPost(page.request, `seo-hidden-${Date.now()}`, { seoNoindex: true });
    const draft = await createPost(page.request, `seo-draft-${Date.now()}`, { status: "draft" });
    ids.push(hidden.id, draft.id);
    await page.goto("/posts?page=2");
    const origin = new URL(page.url()).origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/posts?page=2`);
    await expect(page).toHaveTitle(/第 2 页/);
    await page.goto("/posts?page=999999");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto("/search?q=SEO");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto("/admin/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto(`/posts/${hidden.slug}`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator("h1")).toHaveText(hidden.title);
    // Next's streamed not-found response can have HTTP 200; it must still
    // exclude draft content and tell crawlers not to index the error page.
    const draftHtml = await (await page.request.get(`/posts/${draft.slug}`)).text();
    expect(draftHtml).not.toContain(draft.title);
    expect(draftHtml).not.toContain("这是保持原样的文章正文。");
    expect(draftHtml).toMatch(/name="robots" content="noindex/);
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${origin}/posts</loc>`);
    expect(sitemap).not.toContain(`/posts/${hidden.slug}`);
    expect(sitemap).not.toContain(`/posts/${draft.slug}`);
  } finally {
    for (const id of ids) await page.request.delete(`/api/admin/v1/posts/${id}`);
  }
});
