import { expect, test } from "@playwright/test";

type ClipboardWindow = Window & { codeCopies?: string[] };

for (const width of [390, 1440]) {
  test(`long code defers line nodes and preserves full copies at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            const target = window as ClipboardWindow;
            (target.codeCopies ??= []).push(text);
          },
        },
      });
    });
    const login = await request.post("/api/admin/login", { data: { password: "e2e-test-password" } });
    expect(login.status()).toBe(200);
    const lines = Array.from({ length: 2710 }, (_, index) => `line ${index + 1}: ${"long horizontally scrolling code ".repeat(8)}`);
    lines[1] = "";
    lines[2] = "\t  preserve whitespace & < >";
    lines[2709] = '</template><img src="x" onerror="window.codeInjected=true">';
    const source = lines.join("\n");
    const slug = `e2e-long-code-${width}`;
    const created = await request.post("/api/admin/v1/posts", {
      data: { title: `Long code ${width}`, slug, content: `\`\`\`text\n${source}\n\`\`\``, cover: null, category: "", tags: "", attachmentIds: [], status: "published" },
    });
    expect(created.status()).toBe(200);
    const id = (await created.json()).data.id;
    try {
      const response = await page.goto(`/posts/${slug}`);
      expect(response?.status()).toBe(200);
      const block = page.locator(".code-block").first();
      await expect(block.locator("pre code .line")).toHaveCount(12);
      await expect(block).toHaveAttribute("data-lines", "2710");
      await expect(block.locator("template[data-code-source]")).toHaveCount(1);
      expect(await block.locator("template").evaluate(node => (node as HTMLTemplateElement).content.childElementCount)).toBe(0);
      await expect(block.locator("img")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const pre = block.locator("pre");
      await pre.evaluate(node => { node.scrollLeft = 150; });
      expect(await pre.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      await block.locator("[data-code-copy]").click();
      await expect.poll(() => page.evaluate(() => (window as ClipboardWindow).codeCopies?.length)).toBe(1);
      expect(await page.evaluate(() => (window as ClipboardWindow).codeCopies?.[0])).toBe(source);

      const toggle = block.locator("[data-code-expand]");
      await toggle.click();
      await expect(block.locator("pre code .line")).toHaveCount(2710);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toHaveAccessibleName("收起代码");
      expect(await block.locator("pre code .line").last().textContent()).toBe(lines[2709]);
      await expect(block.locator("img")).toHaveCount(0);
      await block.locator("[data-code-copy]").click();
      await expect.poll(() => page.evaluate(() => (window as ClipboardWindow).codeCopies?.length)).toBe(2);
      expect(await page.evaluate(() => (window as ClipboardWindow).codeCopies?.[1])).toBe(source);

      await toggle.click();
      await expect(block.locator("pre code .line")).toHaveCount(12);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await pre.evaluate(node => { node.scrollLeft = 150; });
      expect(await pre.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      await block.locator("[data-code-copy]").click();
      await expect.poll(() => page.evaluate(() => (window as ClipboardWindow).codeCopies?.length)).toBe(3);
      expect(await page.evaluate(() => (window as ClipboardWindow).codeCopies?.[2])).toBe(source);
      await toggle.click();
      await expect(block.locator("pre code .line")).toHaveCount(2710);
    } finally {
      await request.delete(`/api/admin/v1/posts/${id}`);
    }
  });
}
