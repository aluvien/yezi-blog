import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-attachments-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { createAttachment, db, listAttachments, setSiteSettings } = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("attachment embedded in About page Markdown is retained as a site setting reference", () => {
  const attachmentPath = "/uploads/202608/about-image.webp";
  const attachment = createAttachment({
    path: attachmentPath,
    original_name: "about-image.webp",
    mime_type: "image/webp",
    size: 12,
  });
  setSiteSettings({ about_content: `# 关于\n\n![个人照片](${attachmentPath})` });

  const usage = listAttachments().find((item) => item.id === attachment.id);
  assert.ok(usage);
  assert.equal(usage.referenced, true);
  assert.deepEqual(usage.references, [
    { type: "setting", id: 0, label: "关于页内容", usage: "content" },
  ]);
});
