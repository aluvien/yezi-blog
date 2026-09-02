import { expect, test, type Page } from "@playwright/test";

const password = "e2e-test-password";

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill(password);
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

type CapturedRequest = { method: string; url: string; body: string };

test("Permissions-Policy keeps geolocation disabled publicly but enabled for admin pages", async ({ request }) => {
  const home = await request.get("/");
  const homePolicy = home.headers()["permissions-policy"] ?? "";
  expect(homePolicy).toContain("geolocation=()");
  expect(homePolicy).not.toContain("geolocation=(self)");

  const admin = await request.get("/admin/login");
  const adminPolicy = admin.headers()["permissions-policy"] ?? "";
  // 全局禁用与后台放行两条声明都会出现；Permissions-Policy 解析按后者覆盖。
  expect(adminPolicy).toContain("geolocation=(self)");
});

test("admin “use current location” works and sends coordinates via POST body only", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3100" });
  await context.setGeolocation({ latitude: 30.2741, longitude: 120.1551 });
  await login(page);

  const captured: CapturedRequest[] = [];
  await page.route("**/api/admin/moments/reverse-geocode", async (route) => {
    const request = route.request();
    captured.push({ method: request.method(), url: request.url(), body: request.postData() ?? "" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: "杭州市" }),
    });
  });

  await page.goto("/admin/moments/new");
  await page.getByRole("button", { name: "使用现在位置" }).click();
  await expect(page.getByLabel("想法位置")).toHaveValue("杭州市", { timeout: 15_000 });

  expect(captured.length).toBe(1);
  expect(captured[0].method).toBe("POST");
  expect(captured[0].url).not.toContain("lat=");
  expect(captured[0].url).not.toContain("lng=");
  expect(captured[0].body).toContain("30.2741");
  expect(captured[0].body).toContain("120.1551");
});
