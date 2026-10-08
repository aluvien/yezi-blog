import { expect, test } from "@playwright/test";

test("classic mobile navigation remains visible and updates the active section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-layout-theme", "classic");
  const navigation = page.locator(".sidebar-public-nav");
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(5);
  const lastLink = navigation.getByRole("link").last();
  const destination = await lastLink.getAttribute("href");
  await lastLink.click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(navigation.getByRole("link").last()).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
