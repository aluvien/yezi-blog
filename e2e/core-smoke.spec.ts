import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const password = "e2e-test-password";
const title = "E2E smoke post";
const slug = "e2e-smoke-post";
const initialContent = "这是 E2E 草稿正文。";
const updatedContent = "这是 E2E 已发布并更新后的正文。";

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill(password);
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.serial("core editorial smoke flows", () => {
  test("unauthenticated admin API access is rejected", async ({ request }) => {
    const response = await request.get("/api/admin/telegram");
    expect(response.status()).toBe(401);
    const upload = await request.post("/api/admin/upload");
    expect(upload.status()).toBe(401);
  });

  test("admin creates a draft, uploads and inserts an image, publishes, then edits the post", async ({ page }) => {
    await login(page);
    await page.goto("/admin/posts/new");
    await page.getByPlaceholder("文章标题").fill(title);
    await page.getByPlaceholder("my-first-post").fill(slug);
    const editor = page.getByPlaceholder("# 开始写作…");
    await editor.fill(initialContent);

    const uploadInput = page.locator('input[type="file"]').first();
    const imageBuffer = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 40, g: 120, b: 200, alpha: 1 } },
    }).png().toBuffer();
    await uploadInput.setInputFiles({
      name: "smoke.png",
      mimeType: "image/png",
      buffer: imageBuffer,
    });
    await expect(page.getByText("smoke.png")).toBeVisible();
    await page.getByRole("button", { name: "插入" }).first().click();
    await expect(editor).toHaveValue(/!\[smoke\.png\]\(\/uploads\//);

    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await expect(page.getByLabel(`编辑文章：${title}`)).toBeVisible();

    await page.getByLabel(`编辑文章：${title}`).click();
    await page.getByLabel("发布状态").selectOption("published");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await expect(page.getByText("已发布", { exact: true })).toBeVisible();

    await page.goto(`/posts/${slug}`);
    await expect(page.getByText(initialContent)).toBeVisible();
    await expect(page.locator('img[src^="/image?"]')).toHaveCount(1);

    await page.goto("/admin/posts");
    await page.getByLabel(`编辑文章：${title}`).click();
    await editor.fill(updatedContent);
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await page.goto(`/posts/${slug}`);
    await expect(page.getByText(updatedContent)).toBeVisible();
  });

  test("visitor comment is approved by an admin and becomes public", async ({ page }) => {
    await page.goto(`/posts/${slug}`);
    await page.getByRole("button", { name: "写评论" }).click();
    await page.getByPlaceholder("昵称（必填）").fill("E2E 访客");
    await page.getByPlaceholder("邮箱（选填，不公开）").fill("visitor@example.com");
    await page.getByPlaceholder("写下你的想法…").fill("E2E 评论内容");
    await page.getByRole("button", { name: "提交" }).click();
    await expect(page.getByRole("status")).toHaveText("评论已提交，将在审核后展示。");

    await login(page);
    await page.goto("/admin/comments?status=pending");
    await expect(page.getByText("E2E 评论内容")).toBeVisible();
    await page.getByRole("button", { name: "通过并公开" }).click();
    await expect(page.getByText("当前筛选下暂无评论")).toBeVisible();

    await page.goto(`/posts/${slug}`);
    await expect(page.locator("#comments").getByText("E2E 评论内容", { exact: true })).toBeVisible();
  });

  test("admin can delete the published post", async ({ page }) => {
    await login(page);
    await page.goto("/admin/posts");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByLabel(`编辑文章：${title}`)).toHaveCount(0);
    await page.goto(`/posts/${slug}`);
    await expect(page.getByText("404")).toBeVisible();
  });
});
