import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("update stays disabled until a newer version is confirmed, and a raced no-op never polls a deployment", async ({ page }) => {
  await login(page);
  let state = "up-to-date";
  let syncRequests = 0;
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: state, localCommit: "aaaaaaa", remoteCommit: state === "outdated" ? "bbbbbbb" : "aaaaaaa" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: { status: "unknown" } } }));
  await page.route("**/api/admin/v1/deploy/sync?*", route => {
    syncRequests += 1;
    state = "up-to-date";
    return route.fulfill({ json: { data: { changed: false, message: "代码已是最新，无需更新，网站继续正常运行。" } } });
  });
  await page.goto("/admin/settings");
  const button = page.getByRole("button", { name: "同步 GitHub", exact: true });
  await expect(page.getByText("代码已是最新 · aaaaaaa")).toBeVisible();
  await expect(button).toBeDisabled();
  expect(syncRequests).toBe(0);
  state = "unavailable";
  await page.getByRole("button", { name: "检查版本", exact: true }).click();
  await expect(page.getByText("暂时无法检查 GitHub 最新版本", { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  state = "outdated";
  await page.getByRole("button", { name: "检查版本", exact: true }).click();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("代码已是最新，无需更新，网站继续正常运行。")).toBeVisible();
  await expect(button).toBeDisabled();
  expect(syncRequests).toBe(1);
});

test("background progress resumes after refresh and reports build and completion", async ({ page }) => {
  await login(page);
  let stage = "installing";
  let completed = false;
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: completed ? "up-to-date" : "outdated", localCommit: "aaaaaaa", remoteCommit: "bbbbbbb" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: completed
    ? { status: "success", taskId: "test-task", message: "更新完成，网站正常运行" }
    : { status: "building", taskId: "test-task", stage, step: stage === "installing" ? 2 : 3, totalSteps: 6, message: stage === "installing" ? "正在工作目录安装依赖，旧站保持在线" : "正在构建新版本，旧站保持在线" } } }));
  await page.goto("/admin/settings");
  await expect(page.getByText("正在工作目录安装依赖，旧站保持在线")).toBeVisible();
  await expect(page.getByRole("button", { name: "更新中…" })).toBeDisabled();
  stage = "building";
  await page.reload();
  await expect(page.getByText("正在构建新版本，旧站保持在线")).toBeVisible();
  await expect(page.getByText("更新步骤 3/6")).toBeVisible();
  completed = true;
  await expect(page.getByText("更新完成，网站正常运行")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "同步 GitHub", exact: true })).toBeDisabled();
});
