import { expect, test, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("管理员密码").fill("e2e-test-password");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
test("article drafts recover only on request, warn before leaving, survive failed saves, and clear after success", async ({ page }) => {
  await login(page);
  await page.goto("/admin/posts/new");
  const content = page.getByPlaceholder("# 开始写作…");
  await page.getByPlaceholder("文章标题").fill("Draft recovery test");
  await page.getByPlaceholder("my-first-post").fill("draft-recovery-test");
  await content.fill("Draft survives refresh");
  await expect(page.getByText("草稿已保存在本浏览器，尚未保存到网站")).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator('a[href="/admin/posts"]').first().click();
  await expect(page).toHaveURL(/\/admin\/posts\/new$/);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "恢复草稿", exact: true })).toBeVisible();
  await expect(content).toHaveValue("");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(content).toHaveValue("Draft survives refresh");
  await page.route("**/admin/posts/new", route => route.request().method() === "POST" ? route.abort() : route.continue());
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("保存失败，请检查网络后重试，浏览器草稿已保留。")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yezi:editor:v1:post:new"))).toContain("Draft survives refresh");
  await page.unroute("**/admin/posts/new");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/posts$/);
  expect(await page.evaluate(() => localStorage.getItem("yezi:editor:v1:post:new"))).toBeNull();
});
test("moment drafts restore text and metadata on mobile", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await login(page); await page.goto("/admin/moments/new");
  await page.getByLabel("絮语内容").fill("Moment draft on mobile");
  await expect(page.getByText("草稿已保存在本浏览器，尚未保存到网站")).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await page.reload();
  await page.getByRole("button", {name:"恢复草稿",exact:true}).click();
  await expect(page.getByLabel("絮语内容")).toHaveValue("Moment draft on mobile");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button", {name:"发布",exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/moments$/);
  expect(await page.evaluate(()=>localStorage.getItem("yezi:editor:v1:moment:new"))).toBeNull();
});
test("moment thumbnail editor persists settings through server actions and resets them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/admin/moments/new");
  const content = `Thumbnail editor ${Date.now()}`;
  await page.getByLabel("絮语内容").fill(content);
  await page.getByLabel("保留原图").check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "thumbnail.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/0sAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "编辑图片 1 的缩略图" }).click();
  await page.getByLabel("显示比例").selectOption("0.75");
  await page.getByLabel("缩放").fill("2");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/moments$/);
  const response = await page.request.get("/api/v1/moments");
  const saved = (await response.json()).data.find((item: { content: string }) => item.content === content);
  expect(saved).toBeTruthy();
  expect(saved.imageCrops[saved.images[0]]).toMatchObject({ aspectRatio: 0.75, zoom: 2 });
  await page.goto(`/admin/moments/${saved.id}/edit`);
  await page.getByRole("button", { name: "编辑图片 1 的缩略图" }).click();
  await expect(page.getByLabel("显示比例")).toHaveValue("0.75");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/moments$/);
  const updated = (await (await page.request.get("/api/v1/moments")).json()).data.find((item: { id: number }) => item.id === saved.id);
  expect(updated.imageCrops).toEqual({});
  expect(updated.images).toEqual(saved.images);
});

test("attachment recycle bin restores a deleted upload at its original URL", async ({ page }) => {
  await login(page);
  const fileName = `recoverable-${Date.now()}.txt`;
  const response = await page.request.post("/api/admin/upload", { multipart: {file:{name:fileName,mimeType:"text/plain",buffer:Buffer.from("Recoverable attachment")}} });
  expect(response.ok()).toBe(true);
  const uploaded = await response.json();
  await page.goto("/admin/attachments");
  const row = page.locator("li").filter({has:page.getByText(fileName,{exact:true})});
  page.once("dialog", dialog=>dialog.accept());
  await row.getByRole("button",{name:"删除",exact:true}).click();
  const trash = page.getByRole("region",{name:/附件回收站/});
  await expect(trash.getByText(fileName,{exact:true})).toBeVisible();
  expect((await page.request.get(uploaded.path)).status()).toBe(404);
  await trash.locator("li").filter({ has: page.getByText(uploaded.path, { exact: true }) }).getByRole("button",{name:"恢复",exact:true}).click();
  await expect(trash.getByText(fileName,{exact:true})).toHaveCount(0);
  expect(await (await page.request.get(uploaded.path)).text()).toBe("Recoverable attachment");
});
