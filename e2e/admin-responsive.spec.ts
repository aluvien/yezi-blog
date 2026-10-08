import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: "up-to-date" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: { status: "unknown" } } }));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroller = page.locator(".admin-workspace-scroll");
  expect(await scroller.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

test("mobile admin drawer traps focus, dismisses, and navigates without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole("heading", { name: "后台概览", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard-mobile.png") });
  const open = page.getByRole("button", { name: "打开后台菜单" });
  await open.click();
  const drawer = page.getByRole("dialog", { name: "后台菜单" });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("drawer-mobile.png") });
  for (let i = 0; i < 23; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await drawer.getByRole("link", { name: "Yezi 网站管理" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: "访问网站" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole("link", { name: "备份恢复", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/backups$/);
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("tab", { name: "服务器本地" })).toHaveAttribute("aria-selected", "true");
  await open.click();
  await page.mouse.click(380, 400);
  await expect(drawer).not.toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/admin", "/admin/posts", "/admin/comments", "/admin/attachments", "/admin/settings", "/admin/settings/backups"]) {
      await page.goto(route);
      await noOverflow(page);
    }
  }
});

test("cloud cards paginate, keep edits across tabs and expose recovery on phones", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const siteId = "11111111-1111-4111-8111-111111111111";
  const settings = { siteId, siteLabel: "yezi.me", siteLabels: ["yezi.me"], endpoint: "https://dav.example", username: "test", directory: "backup", keep: 14, dailyEnabled: false, hasPassword: true, hasKey: true };
  const files = Array.from({ length: 7 }, (_, index) => ({ name: `example-${index}.enc`, site: "yezi.me", siteId, createdAt: "2026-10-08T00:00:00Z", sizeBytes: 302869872 }));
  await page.route("**/api/admin/v1/backups/cloud", route => route.fulfill({ json: { data: { settings, task: null } } }));
  await page.route("**/api/admin/v1/backups/cloud/files", route => route.fulfill({ json: { data: files } }));
  await page.goto("/admin/settings/backups?tab=cloud");
  const list = page.getByRole("list", { name: "云端备份列表" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list.getByText("已校验", { exact: true })).toHaveCount(0);
  await expect(list.getByText("待校验", { exact: true })).toHaveCount(5);
  await page.getByRole("button", { name: "切换后台明暗主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("backups-dark-mobile.png") });
  await page.getByRole("button", { name: "切换后台明暗主题" }).click();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("backups-mobile.png") });
  await list.getByRole("listitem").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("backup-list-mobile.png") });
  await page.locator(".admin-workspace-scroll").evaluate(node => node.scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: testInfo.outputPath("backups-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "云端备份分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list.getByLabel("更多操作 example-5.enc", { exact: true }).click();
  await expect(list.getByRole("button", { name: "删除备份 example-5.enc", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list.getByRole("button", { name: "删除备份 example-5.enc", exact: true })).not.toBeVisible();
  await expect(list.getByRole("link", { name: "下载备份 example-5.enc", exact: true })).toBeVisible();
  await expect(list.getByRole("button", { name: "恢复此备份 example-5.enc", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "云端设置", exact: true }).click();
  await page.getByLabel("WebDAV 账号").fill("unsaved-mobile");
  await page.getByRole("tab", { name: "服务器本地" }).click();
  await page.getByRole("tab", { name: "云端备份" }).click();
  await expect(page.getByLabel("WebDAV 账号")).toHaveValue("unsaved-mobile");
  await expect(page.getByRole("button", { name: "备份到云端", exact: true })).toBeDisabled();
  await noOverflow(page);
});

test("desktop sidebar collapses and settings show unsaved changes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await expect(page.getByRole("button", { name: "打开后台菜单" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dashboard-desktop.png") });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(page.getByRole("button", { name: "展开侧栏" })).toBeVisible();
  await page.getByRole("navigation", { name: "后台导航" }).getByRole("link", { name: "站点设置", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "后台导航" }).getByRole("link", { name: "站点设置", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("网站地址").fill("https://mobile.example");
  await expect(page.getByText("有未保存的修改", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "设置已保存" })).toBeVisible();
  await expect(page.getByText("有未保存的修改", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  // Restore the test server's address for subsequent suites.
  await page.getByLabel("网站地址").fill("http://127.0.0.1:3100");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "设置已保存" })).toBeVisible();
});
