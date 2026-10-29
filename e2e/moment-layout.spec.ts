import { expect, test } from "@playwright/test";

test("native attachment positions persist and render above or below body in the website lists", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", { data: { password: "e2e-test-password" } });
  expect(login.ok()).toBe(true);
  const capability = await page.request.get("/api/admin/v1/moments/layout");
  expect((await capability.json()).data.supported).toBe(true);
  const response = await page.request.post("/api/admin/v1/moments", { data: {
    content: "附件位置回归正文", images: ["/uploads/layout-fixture.png"], imagePlacement: "top", musicPlacement: "bottom",
  } });
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  try {
    for (const placement of ["top", "bottom"]) {
      const saved = await page.request.patch(`/api/admin/v1/moments/${data.id}`, { data: { imagePlacement: placement } });
      expect(saved.ok()).toBe(true);
      for (const url of ["/moments", "/"]) {
        await page.goto(url);
        const card = page.locator(`#moment-${data.id}`);
        await expect(card).toContainText("附件位置回归正文");
        const imageFirst = await card.evaluate(element => {
          const image = element.querySelector(".bit-media");
          const body = element.querySelector(".bit-body");
          return Boolean(image && body && (image.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(imageFirst).toBe(placement === "top");
      }
    }
  } finally {
    expect((await page.request.delete(`/api/admin/v1/moments/${data.id}`)).ok()).toBe(true);
  }
});
