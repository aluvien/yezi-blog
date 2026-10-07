import { expect, test, type Page } from "@playwright/test";
import http from "node:http";

const remote = new Map<string, Buffer>();
let endpoint = "";
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Basic ${Buffer.from("e2e-user:e2e-webdav-private").toString("base64")}`) { response.writeHead(401); response.end(); return; }
  const pieces: Buffer[] = [];
  for await (const part of request) pieces.push(Buffer.from(part));
  const pathname = new URL(request.url!, "http://localhost").pathname;
  if (request.method === "PROPFIND") {
    if (!Buffer.concat(pieces).toString().includes("allprop")) { response.writeHead(404); response.end(); return; }
    let entries = '<d:response><d:href>/backup/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
    if (request.headers.depth === "1") for (const [name, data] of remote) entries += `<d:response><d:href>/backup/${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${data.length}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    response.writeHead(207); response.end(`<d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`); return;
  }
  const name = decodeURIComponent(pathname.slice("/backup/".length));
  if (request.method === "PUT") { remote.set(name, Buffer.concat(pieces)); response.writeHead(201); response.end(); return; }
  if (request.method === "GET" && remote.has(name)) { response.writeHead(200); response.end(remote.get(name)); return; }
  if (request.method === "DELETE") { remote.delete(name); response.writeHead(204); response.end(); return; }
  response.writeHead(404); response.end();
});
test.beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
async function login(page: Page) {
  await page.goto("/admin/login"); await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click(); await expect(page).toHaveURL(/\/admin$/);
}
async function stubDeploy(page: Page) {
  await page.route("**/api/admin/v1/deploy/version?*", route => route.fulfill({ json: { data: { status: "up-to-date" } } }));
  await page.route("**/api/admin/v1/deploy/status?*", route => route.fulfill({ json: { data: { status: "unknown" } } }));
}
test("cloud settings and recovery keys require admin authentication and same-origin writes", async ({ page, request }) => {
  for (const suffix of ["", "/files", "/key", "/download?id=../../.env.local"]) expect((await request.get(`/api/admin/v1/backups/cloud${suffix}`)).status()).toBe(401);
  await login(page);
  const rejected = await page.request.patch("/api/admin/v1/backups/cloud", { data: {}, headers: { origin: "https://evil.example" } });
  expect(rejected.status()).toBe(403);
  const invalidRestore = await page.request.post("/api/admin/v1/backups/cloud/restore", { data: { id: "../../.env.local", confirmation: "" } });
  expect(invalidRestore.status()).toBe(400);
});
test("custom WebDAV settings, connection test, encrypted backup and verified one-click recovery work together", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page); await stubDeploy(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "备份恢复", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/backups$/);
  await expect(page.getByRole("heading", { name: "备份恢复", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "云备份与恢复" });
  await panel.getByLabel("WebDAV 地址").fill(endpoint);
  await panel.getByLabel("备份目录", { exact: true }).fill("backup");
  await panel.getByLabel("WebDAV 账号").fill("e2e-user");
  await panel.getByLabel("WebDAV 密码").fill("e2e-webdav-private");
  await panel.getByRole("button", { name: "保存云备份配置" }).click();
  await expect(panel.getByText("云备份配置已保存。请测试连接，并导出恢复密钥单独保存。")).toBeVisible();
  const settingsResponse = await page.request.get("/api/admin/v1/backups/cloud");
  expect(await settingsResponse.text()).not.toContain("e2e-webdav-private");
  await expect(panel.getByLabel("WebDAV 密码")).toHaveValue("");
  await panel.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(panel.getByText(/连接测试通过/)).toBeVisible({ timeout: 20_000 });
  expect(remote.size).toBe(0);
  const keyDownload = page.waitForEvent("download"); await panel.getByRole("link", { name: "导出恢复密钥" }).click();
  expect((await keyDownload).suggestedFilename()).toBe("yezi-cloud-recovery-key.txt");
  await page.waitForTimeout(3000);
  await panel.getByLabel("WebDAV 账号").fill("unsaved-edit");
  await page.waitForTimeout(3000); await expect(panel.getByLabel("WebDAV 账号")).toHaveValue("unsaved-edit");
  await page.reload(); await expect(panel.getByLabel("WebDAV 账号")).toHaveValue("e2e-user");
  await panel.getByRole("button", { name: "备份到云端", exact: true }).click();
  expect((await page.request.get("/")).status()).toBe(200);
  await expect(panel.getByText(/云备份完成，远程回读校验通过/)).toBeVisible({ timeout: 25_000 });
  const filename = [...remote.keys()][0]; expect(filename).toMatch(/^yezi-complete-.*\.tar\.gz\.enc$/);
  expect(remote.get(filename)!.subarray(0, 10).toString()).toBe("YEZICLOUD1");
  const created = await page.request.post("/api/admin/v1/posts", { data: { title: "云备份后新增", slug: `cloud-after-${Date.now()}`, content: "恢复后应不存在", status: "draft", cover: null, category: "", tags: "", attachmentIds: [], referenceSnapshots: [] } });
  expect(created.status()).toBe(200); const id = (await created.json()).data.id;
  await panel.getByRole("button", { name: `下载并校验 ${filename}` }).click();
  await expect(panel.getByText("恢复预览 · 校验通过")).toBeVisible({ timeout: 25_000 });
  await expect(panel.getByRole("button", { name: "恢复数据库与文件", exact: true })).toBeDisabled();
  await panel.getByLabel("填写“恢复数据”确认覆盖").fill("恢复数据");
  const applied = page.waitForResponse(response => response.url().endsWith("/backups/cloud/restore") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "恢复数据库与文件", exact: true }).click();
  const result = await applied; expect(result.status()).toBe(200);
  await expect(panel.getByText(/数据恢复完成/)).toBeVisible();
  expect((await page.request.get("/api/admin/v1/backups/cloud")).status()).toBe(401);
  await login(page);
  expect((await page.request.get(`/api/admin/v1/posts/${id}`)).status()).toBe(404);
  expect((await page.request.get("/")).status()).toBe(200);
});
