import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-admin-auth-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");
process.env.ADMIN_API_TOKEN = "native-admin-token-with-more-than-thirty-two-characters";

const { authorizeAdminApi } = await import("../src/lib/admin-api.ts");
const { db } = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("documented Bearer token authenticates native reads and writes without browser Origin", async () => {
  for (const method of ["GET", "POST"]) {
    const request = new Request("https://yezi.test/api/admin/v1/settings", {
      method,
      headers: {
        authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    const result = await authorizeAdminApi(request);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.session.id, "bearer");
  }
});

test("cookie-shaped hostile writes are rejected before authentication or side effects", async () => {
  const crossOrigin = await authorizeAdminApi(new Request("https://yezi.test/api/admin/v1/settings", {
    method: "PATCH",
    headers: { origin: "https://sibling.test", "content-type": "application/json", "x-yezi-csrf": "1" },
    body: "{}",
  }));
  assert.equal(crossOrigin.ok, false);
  assert.equal(!crossOrigin.ok && crossOrigin.response.status, 403);

  const plainText = await authorizeAdminApi(new Request("https://yezi.test/api/admin/v1/settings", {
    method: "PATCH",
    headers: { origin: "https://yezi.test", "content-type": "text/plain", "x-yezi-csrf": "1" },
    body: "{}",
  }));
  assert.equal(plainText.ok, false);
  assert.equal(!plainText.ok && plainText.response.status, 415);
});
