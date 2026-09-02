import { expect, test, type Page } from "@playwright/test";

async function useModernLayout(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const response = await page.request.patch("/api/admin/v1/settings", { data: { layout_theme: "editorial" } });
  expect(response.status()).toBe(200);
}

test("mobile menu is modal: focus stays inside while open and returns to the trigger after Escape", async ({ page }) => {
  await useModernLayout(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开菜单" });
  await trigger.click();
  const drawer = page.locator(".site-mobile-drawer");
  await expect(drawer).toBeVisible();

  // 原生 <dialog>.showModal() 的焦点陷阱：连续 Tab 不允许落到抽屉外的背景控件
  // （环绕时可能短暂经过 body，那不是可交互逃逸）。
  const escaped: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.closest(".site-mobile-drawer")) return null;
      return `${el.tagName}:${(el.textContent || "").trim().slice(0, 20)}`;
    });
    if (outside) escaped.push(outside);
  }
  expect(escaped, `焦点逃出了抽屉：${escaped.join(", ")}`).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "打开菜单" })).toBeFocused();

  // 点击关闭按钮同样把焦点还给触发按钮。
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "关闭菜单" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "打开菜单" })).toBeFocused();
});
