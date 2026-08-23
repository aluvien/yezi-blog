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

  test("installed PWA uses the five-item bottom navigation instead of the mobile menu button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
    });
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-display-mode", "standalone");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    await expect(page.getByLabel("打开菜单")).toBeHidden();
    const navigation = page.getByRole("navigation", { name: "PWA 主导航" });
    await expect(navigation).toBeVisible();
    await expect(navigation).toHaveCSS("min-height", "66px");
    await expect(navigation.getByRole("link")).toHaveCount(5);
    for (const label of ["首页", "文章", "想法", "作品", "关于"]) {
      await expect(navigation.getByRole("link", { name: label })).toBeVisible();
    }

    const musicAlignment = await page.evaluate(() => {
      const float = document.createElement("button");
      float.className = "global-player-float";
      const panel = document.createElement("div");
      panel.className = "global-player-panel is-open";
      panel.innerHTML = '<div class="global-player-host">播放器</div>';
      document.body.append(float, panel);
      const nav = document.querySelector<HTMLElement>(".site-pwa-bottom-nav")!;
      const result = {
        floatGap: Math.round(nav.getBoundingClientRect().top - float.getBoundingClientRect().bottom),
        panelBottom: Math.round(panel.getBoundingClientRect().bottom),
        navTop: Math.round(nav.getBoundingClientRect().top),
        playerSafeArea: getComputedStyle(panel.querySelector<HTMLElement>(".global-player-host")!).paddingBottom,
      };
      float.remove();
      panel.remove();
      const closedPanel = document.createElement("div");
      closedPanel.className = "global-player-panel";
      closedPanel.innerHTML = '<div class="global-player-host" style="height: 120px">播放器</div>';
      document.body.append(closedPanel);
      const closedPanelTop = Math.round(closedPanel.getBoundingClientRect().top);
      closedPanel.remove();
      return { ...result, closedPanelTop, viewportHeight: window.innerHeight };
    });
    expect(musicAlignment.floatGap).toBe(12);
    expect(musicAlignment.panelBottom).toBe(musicAlignment.navTop);
    expect(musicAlignment.playerSafeArea).toBe("0px");
    expect(musicAlignment.closedPanelTop).toBeGreaterThanOrEqual(musicAlignment.viewportHeight);
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

  test("admin formats and publishes About page Markdown with the shared toolbar", async ({ page }) => {
    await login(page);
    await page.goto("/admin/pages/about");
    const editor = page.getByLabel("关于页内容（Markdown）");
    await editor.fill("关于页面 E2E 内容");
    await editor.focus();
    await page.getByRole("button", { name: "H2", exact: true }).click();
    await expect(editor).toHaveValue("## 关于页面 E2E 内容");

    await page.getByRole("button", { name: "预览" }).click();
    await expect(page.getByRole("heading", { name: "关于页面 E2E 内容", level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "返回编辑" }).click();
    await page.getByRole("button", { name: "保存关于页面" }).click();
    await expect(page.getByText("关于页面已保存")).toBeVisible();

    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "关于页面 E2E 内容", level: 2 })).toBeVisible();
  });

  test("appearance settings uses the full available admin content width", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings/appearance");
    const [mainBox, panelBox] = await Promise.all([
      page.locator("main.admin-main").boundingBox(),
      page.locator("fieldset").first().boundingBox(),
    ]);
    if (!mainBox || !panelBox) throw new Error("外观设置布局未加载");
    expect(panelBox.width).toBeGreaterThan(mainBox.width * 0.9);
  });

  test("admin can delete the published post", async ({ page }) => {
    await login(page);
    await page.goto("/admin/posts");
    page.once("dialog", (dialog) => dialog.accept());
    const postCard = page.locator("li").filter({ has: page.getByLabel(`编辑文章：${title}`) });
    await postCard.getByRole("button", { name: "删除" }).click();
    await expect(page.getByLabel(`编辑文章：${title}`)).toHaveCount(0);
    await page.goto(`/posts/${slug}`);
    await expect(page.getByText("404")).toBeVisible();
  });
});
