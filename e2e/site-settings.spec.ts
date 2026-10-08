import { expect, test } from "@playwright/test";

test("website address saves from settings and updates backup identity and links without restart", async ({ page }) => {
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: "up-to-date" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: { status: "unknown" } } }));
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const original = (await (await page.request.get("/api/admin/v1/settings")).json()).data.site_url || "";
  const identity = (await (await page.request.get("/api/admin/v1/backups/cloud")).json()).data.settings;
  try {
    await page.goto("/admin/settings");
    const field = page.getByLabel("网站地址", { exact: false });
    await field.fill("https://runtime.example/");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
    await page.reload();
    await expect(field).toHaveValue("https://runtime.example");
    const updated = (await (await page.request.get("/api/admin/v1/backups/cloud")).json()).data.settings;
    expect(updated.siteId).toBe(identity.siteId);
    expect(updated.siteLabel).toBe("runtime.example");
    expect(updated.siteLabels).toContain(identity.siteLabel);
    expect((await (await page.request.get("/api/v1/site")).json()).data.url).toBe("https://runtime.example");
    expect(await (await page.request.get("/sitemap.xml")).text()).toContain("https://runtime.example");
    expect(await (await page.request.get("/robots.txt")).text()).toContain("https://runtime.example/sitemap.xml");
    expect(await (await page.request.get("/rss.xml")).text()).toContain("<link>https://runtime.example</link>");
  } finally {
    expect((await page.request.patch("/api/admin/v1/settings", { data: { site_url: original } })).ok()).toBe(true);
  }
});
