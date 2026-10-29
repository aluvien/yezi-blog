import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-layout-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.ADMIN_API_TOKEN = "layout-test-token-with-more-than-thirty-two-characters";
const { db, getMoment, createMoment } = await import("../src/lib/db.ts");
const { POST } = await import("../src/app/api/admin/v1/moments/route.ts");
const { PATCH } = await import("../src/app/api/admin/v1/moments/[id]/route.ts");
const { GET: support } = await import("../src/app/api/admin/v1/moments/layout/route.ts");
const { GET: publicRead } = await import("../src/app/api/v1/moments/route.ts");
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
function request(method, body, authorized = true) {
  return new Request("https://yezi.test/api/admin/v1/moments/layout", {
    method, headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("authenticated native layout capability advertises actual support without caching", async () => {
  const response = await support(request("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { supported: true });
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("native create and edit round-trip all layouts while preserving crops and legacy edits", async () => {
  const image = "/uploads/a.jpg";
  const crop = { x: 0.2, y: 0.8, zoom: 2 };
  for (const imagePlacement of ["top", "bottom"]) for (const musicPlacement of ["top", "bottom"]) {
    const response = await POST(request("POST", { content: "中文正文", images: [image], imageCrops: { [image]: crop }, imagePlacement, musicPlacement }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.image_placement, imagePlacement);
    assert.equal(data.music_placement, musicPlacement);
    const params = { params: Promise.resolve({ id: String(data.id) }) };
    const updated = await PATCH(request("PATCH", { content: "修改正文" }), params);
    assert.equal(updated.status, 200);
    const saved = (await updated.json()).data;
    assert.equal(saved.image_placement, imagePlacement);
    assert.equal(saved.music_placement, musicPlacement);
    assert.deepEqual(saved.imageCrops[image], crop);
    assert.equal(getMoment(data.id).content, "修改正文");
    const publicData = await (await publicRead(new Request("https://yezi.test/api/v1/moments"))).json();
    assert.equal(publicData.data.find(m => m.id === data.id).image_placement, imagePlacement);
    const cleared = await PATCH(request("PATCH", { image_placement: null, music_placement: null }), params);
    assert.equal((await cleared.json()).data.image_placement, null);
    assert.equal(getMoment(data.id).music_placement, null);
  }
});
test("invalid layouts cannot create or mutate a moment; old records retain legacy layout", async () => {
  const original = createMoment({ content: "旧絮语" });
  assert.equal(original.image_placement, null);
  assert.equal(original.music_placement, null);
  for (const bad of ["left", "", false, 1, {}]) {
    assert.equal((await POST(request("POST", { content: "invalid", images: [], imagePlacement: bad }))).status, 400);
    assert.equal((await PATCH(request("PATCH", { content: "不应保存", musicPlacement: bad }), { params: Promise.resolve({ id: String(original.id) }) })).status, 400);
    assert.equal(getMoment(original.id).content, "旧絮语");
  }
});
