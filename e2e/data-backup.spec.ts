import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function stubDeploy(page: Page) {
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: "up-to-date", localCommit: "aaaaaaa", remoteCommit: "aaaaaaa" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: { status: "unknown" } } }));
}

test("backup API protects configuration downloads with admin authentication and same-origin writes", async ({ page, request }) => {
  for (const endpoint of ["/api/admin/v1/backups", "/api/admin/v1/backups/download?id=../../.env.local", "/api/admin/v1/backups/files", "/api/admin/v1/backups/files/download?kind=admin&name=invalid"]) {
    const response = await request.get(endpoint);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("private, no-store");
  }
  const anonymous = await request.post("/api/admin/v1/backups", { data: {} });
  expect(anonymous.status()).toBe(401);
  expect((await request.delete("/api/admin/v1/backups/files", { data: {} })).status()).toBe(401);
  await login(page);
  const invalidDelete = await page.request.delete("/api/admin/v1/backups/files", { data: { kind: "admin", name: "../../.env.local", confirmation: "删除备份" } });
  expect(invalidDelete.status()).toBe(400);
  const noConfirmation = await page.request.delete("/api/admin/v1/backups/files", { data: { kind: "admin", name: "invalid" } });
  expect(noConfirmation.status()).toBe(400);
  const csrfDelete = await page.request.delete("/api/admin/v1/backups/files", { data: {}, headers: { origin: "https://evil.example", "x-yezi-csrf": "1" } });
  expect(csrfDelete.status()).toBe(403);
  const invalidDownload = await page.request.get("/api/admin/v1/backups/files/download?kind=admin&name=../../.env.local");
  expect(invalidDownload.status()).toBe(400);
  const csrf = await page.request.post("/api/admin/v1/backups", { data: {}, headers: { origin: "https://evil.example", "x-yezi-csrf": "1" } });
  expect(csrf.status()).toBe(403);
  const arbitraryPath = await page.request.post("/api/admin/v1/backups", { data: { path: "/etc/passwd" } });
  expect(arbitraryPath.status()).toBe(400);
  const traversal = await page.request.get("/api/admin/v1/backups/download?id=../../.env.local");
  expect(traversal.status()).toBe(404);
});

test("one click produces a verified downloadable backup and the website remains available", async ({ page }) => {
  await login(page);
  await stubDeploy(page);
  const created = await page.request.post("/api/admin/v1/posts", { data: { title: "备份恢复测试", slug: `backup-${Date.now()}`, content: "需要恢复的文章内容", cover: null, category: "", tags: "", status: "draft", attachmentIds: [], referenceSnapshots: [] } });
  expect(created.status()).toBe(200);
  const postId = (await created.json()).data.id;
  await page.goto("/admin/settings/backups");
  const panel = page.getByRole("region", { name: "数据备份" });
  await expect(panel.getByRole("button", { name: "备份并下载" })).toBeEnabled();
  await expect(panel.getByText(/下载包未加密/)).toBeVisible();
  const downloading = page.waitForEvent("download");
  await panel.getByRole("button", { name: "备份并下载" }).click();
  expect((await page.request.get("/")).status()).toBe(200);
  await expect(panel.getByText(/校验通过/)).toBeVisible({ timeout: 15_000 });
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^yezi-backup-.*\.tar\.gz$/);
  expect(await download.failure()).toBeNull();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-e2e-backup-"));
  try {
    const archive = path.join(temporary, "backup.tar.gz");
    await download.saveAs(archive);
    const extracted = path.join(temporary, "restore");
    fs.mkdirSync(extracted);
    const tar = spawnSync("tar", ["-xzf", archive, "-C", extracted]);
    expect(tar.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(extracted, "manifest.json"), "utf8"));
    expect(manifest.files.some((entry: { path: string }) => entry.path === "config/runtime.env")).toBe(true);
    const database = new Database(path.join(extracted, "data", "blog.db"), { readonly: true });
    try {
      expect(database.prepare("SELECT content FROM posts WHERE id = ?").get(postId)).toEqual({ content: "需要恢复的文章内容" });
      expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { database.close(); }
    await expect(panel.getByText(/校验通过/)).toBeVisible();
    const url = await panel.getByRole("link", { name: "下载最近备份" }).getAttribute("href");
    const response = await page.request.get(url!);
    expect(response.headers()["content-type"]).toBe("application/gzip");
    expect(response.headers()["content-disposition"]).toContain("attachment;");
    expect(response.headers()["cache-control"]).toContain("private, no-store");
    const status = await page.request.get("/api/admin/v1/backups");
    expect(await status.text()).not.toContain("e2e-test-password");
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("backup progress survives refresh and an interrupted backup offers retry", async ({ page }) => {
  await login(page);
  await stubDeploy(page);
  let phase = "files";
  let failed = false;
  await page.route("**/api/admin/v1/backups", route => route.fulfill({ json: { data: { id: "00000000-0000-4000-8000-000000000000", status: failed ? "failed" : "running", phase, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...(failed ? { error: "网站进程重启，备份已中断，请重新备份。" } : {}) } } }));
  await page.goto("/admin/settings/backups");
  const panel = page.getByRole("region", { name: "数据备份" });
  await expect(panel.getByText(/复制上传文件/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "正在备份…" })).toBeDisabled();
  phase = "verify";
  await page.reload();
  await expect(panel.getByText(/校验数据库与文件/)).toBeVisible();
  failed = true;
  await expect(panel.getByText(/备份已中断/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "备份并下载" })).toBeEnabled();
});


test("local backup manager counts files, downloads history and confirms deletion", async ({ page }) => {
  await login(page);
  await stubDeploy(page);
  const names: string[] = [];
  for (let index = 0; index < 2; index++) {
    const response = await page.request.post("/api/admin/v1/backups", { data: {} });
    expect(response.status()).toBe(202);
    const id = (await response.json()).data.id;
    names.push(`${id}.tar.gz`);
    await expect.poll(async () => (await (await page.request.get("/api/admin/v1/backups")).json()).data.status, { timeout: 15_000 }).toBe("completed");
  }
  const before = (await (await page.request.get("/api/admin/v1/backups/files")).json()).data;
  await page.goto("/admin/settings/backups");
  const panel = page.getByRole("region", { name: "数据备份" });
  await expect(panel.getByText(`共 ${before.count} 份`, { exact: false })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "服务器本地备份" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await panel.getByRole("link", { name: `下载本地备份 ${names[0]}`, exact: true }).click();
  const history = await downloading;
  expect(history.suggestedFilename()).toBe(names[0]);
  expect(await history.failure()).toBeNull();
  await panel.getByLabel(`更多操作 ${names[1]}`, { exact: true }).click();
  const remove = panel.getByRole("button", { name: `删除本地备份 ${names[1]}`, exact: true });
  page.once("dialog", dialog => dialog.dismiss());
  await remove.click();
  await expect(remove).toBeEnabled();
  expect((await (await page.request.get("/api/admin/v1/backups/files")).json()).data.count).toBe(before.count);
  page.once("dialog", dialog => dialog.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(panel.getByText(`共 ${before.count - 1} 份`, { exact: false })).toBeVisible();
  const latest = await panel.getByRole("link", { name: "下载最近备份", exact: true }).getAttribute("href");
  expect(latest).toContain(names[0]);
  expect((await page.request.get(latest!)).status()).toBe(200);
  expect((await page.request.get("/")).status()).toBe(200);
  const after = (await (await page.request.get("/api/admin/v1/backups/files")).json()).data;
  expect(after.totalBytes).toBeLessThan(before.totalBytes);
  expect(after.files.some((file: { name: string }) => file.name === names[1])).toBe(false);
  expect((await (await page.request.get("/api/admin/v1/backups")).json()).data).toBeNull();
  await page.route("**/api/admin/v1/backups/files", route => route.fulfill({ json: { data: { ...after, busy: true } } }));
  await panel.getByRole("button", { name: "刷新本地备份" }).click();
  await panel.getByLabel(`更多操作 ${names[0]}`, { exact: true }).click();
  await expect(panel.getByRole("button", { name: `删除本地备份 ${names[0]}`, exact: true })).toBeDisabled();
  await expect(panel.getByText(/暂时不能删除本地备份/)).toBeVisible();
});


test("local backup categories paginate five files and adjust pages after deletion or refresh", async ({ page }) => {
  await login(page);
  await stubDeploy(page);
  type File = { kind: string; name: string; sizeBytes: number; createdAt: string; encrypted: boolean };
  let files: File[] = [
    ...Array.from({ length: 6 }, (_, index) => ({ kind: "database", name: `blog-20261008010203${String(index).padStart(3, "0")}-a1234567.db`, sizeBytes: 1024, createdAt: "2026-10-08T01:02:03.000Z", encrypted: false })),
    ...Array.from({ length: 2 }, (_, index) => ({ kind: "admin", name: `00000000-0000-4000-8000-00000000000${index}.tar.gz`, sizeBytes: 2048, createdAt: "2026-10-08T01:02:03.000Z", encrypted: false })),
    { kind: "restore", name: "rollback-00000000-0000-4000-8000-000000000000.tar.gz", sizeBytes: 3072, createdAt: "2026-10-08T01:02:03.000Z", encrypted: false },
  ];
  const sixth = files[5].name;
  let deleted = "";
  await page.route("**/api/admin/v1/backups/files", async route => {
    if (route.request().method() === "DELETE") {
      const body = route.request().postDataJSON();
      expect(body.confirmation).toBe("删除备份");
      deleted = body.name;
      files = files.filter(file => file.kind !== body.kind || file.name !== body.name);
    }
    await route.fulfill({ json: { data: { files, count: files.length, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), busy: false } } });
  });
  await page.goto("/admin/settings/backups");
  const panel = page.getByRole("region", { name: "数据备份" });
  const categories = panel.getByRole("group", { name: "本地备份分类" });
  const list = panel.getByRole("list", { name: "本地备份列表" });
  const pager = panel.getByRole("navigation", { name: "本地备份分页" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(categories.getByRole("button", { name: "全部9", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(pager.getByText(/第 2 \/ 2 页/)).toBeVisible();
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await categories.getByRole("button", { name: "手动完整备份2", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByText("手动完整备份 · 2 份 · 占用 4.00 KB", { exact: true })).toBeVisible();
  await expect(pager).toHaveCount(0);
  await categories.getByRole("button", { name: "自动加密数据备份0", exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(panel.getByText("暂无自动加密数据备份。", { exact: true })).toBeVisible();
  await categories.getByRole("button", { name: "数据库快照6", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(pager.getByText(/第 1 \/ 2 页/)).toBeVisible();
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("link", { name: `下载本地备份 ${sixth}`, exact: true })).toHaveAttribute("href", `/api/admin/v1/backups/files/download?kind=database&name=${sixth}`);
  await list.getByLabel(`更多操作 ${sixth}`, { exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await list.getByRole("button", { name: `删除本地备份 ${sixth}`, exact: true }).click();
  await expect.poll(() => deleted).toBe(sixth);
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(categories.getByRole("button", { name: "数据库快照5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("数据库快照 · 5 份 · 占用 5.00 KB", { exact: true })).toBeVisible();
  await expect(pager).toHaveCount(0);
  await categories.getByRole("button", { name: "全部8", exact: true }).click();
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  files = files.slice(0, 2);
  await panel.getByRole("button", { name: "刷新本地备份" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(pager).toHaveCount(0);
  await expect(panel.getByText("共 2 份 · 占用 2.00 KB", { exact: true })).toBeVisible();
});
