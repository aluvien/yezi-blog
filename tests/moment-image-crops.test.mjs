import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-crops-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.ADMIN_API_TOKEN = "thumbnail-test-token-with-more-than-thirty-two-characters";
const { normalizeMomentImageCrops, parseMomentImageCrops, momentImageCropStyle, momentImageFrameStyle } = await import("../src/lib/moment-image-crops.ts");
const { db, getMoment } = await import("../src/lib/db.ts");
const { POST } = await import("../src/app/api/admin/v1/moments/route.ts");
const { PATCH } = await import("../src/app/api/admin/v1/moments/[id]/route.ts");
const { GET } = await import("../src/app/api/v1/moments/route.ts");
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const image = "/uploads/test.jpg";
const crop = { x: 0.2, y: 0.8, zoom: 2.5, aspectRatio: 4 / 3, originalAspectRatio: 1.5 };
function request(method, body, authorized = true) {
  return new Request("https://yezi.test/api/admin/v1/moments", { method, headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}) }, body: JSON.stringify(body) });
}

test("crop validation rejects invalid geometry and ignores removed image paths", () => {
  for (const invalid of [{ ...crop, x: -0.1 }, { ...crop, y: 1.1 }, { ...crop, zoom: 5 }, { ...crop, x: NaN }, { ...crop, zoom: "2" }]) {
    assert.equal(normalizeMomentImageCrops({ [image]: invalid }, [image]), null);
  }
  assert.deepEqual({ ...normalizeMomentImageCrops({ [image]: crop }, []) }, {});
  assert.deepEqual(parseMomentImageCrops("broken", [image]), {});
  assert.deepEqual(momentImageCropStyle(crop), { objectPosition: "20% 80%", transformOrigin: "20% 80%", transform: "scale(2.5)" });
  assert.deepEqual(momentImageFrameStyle(crop), { aspectRatio: String(4 / 3) });
  assert.equal(momentImageFrameStyle({ x: 0.5, y: 0.5, zoom: 1 }), undefined);
  assert.equal(momentImageFrameStyle({ x: 0.5, y: 0.5, zoom: 1, originalAspectRatio: 1.5 }), undefined);
  assert.deepEqual(momentImageFrameStyle({ x: 0.5, y: 0.5, zoom: 1, originalAspectRatio: 1.5 }, true), { aspectRatio: "1.5" });
  for (const aspectRatio of [0, 21, NaN, "1.5"]) assert.equal(normalizeMomentImageCrops({ [image]: { ...crop, aspectRatio } }, [image]), null);
});

test("authenticated create, public read, legacy edit, reset and image removal preserve the original image", async () => {
  const response = await POST(request("POST", { content: "照片", images: [image], imageCrops: { [image]: crop } }));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.imageCrops[image], crop);
  assert.deepEqual(data.images, [image]);
  const params = { params: Promise.resolve({ id: String(data.id) }) };
  let updated = await PATCH(request("PATCH", { content: "旧版编辑", images: [image] }), params);
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).data.imageCrops[image], crop);
  const publicData = await (await GET(new Request("https://yezi.test/api/v1/moments"))).json();
  assert.deepEqual(publicData.data.find((m) => m.id === data.id).imageCrops[image], crop);
  updated = await PATCH(request("PATCH", { imageCrops: { [image]: { ...crop, zoom: 0 } } }), params);
  assert.equal(updated.status, 400);
  assert.deepEqual(JSON.parse(getMoment(data.id).image_crops)[image], crop);
  updated = await PATCH(request("PATCH", { imageCrops: {} }), params);
  assert.deepEqual((await updated.json()).data.imageCrops, {});
  await PATCH(request("PATCH", { imageCrops: { [image]: crop } }), params);
  updated = await PATCH(request("PATCH", { images: [] }), params);
  assert.deepEqual((await updated.json()).data.imageCrops, {});
});

test("crop updates require authentication", async () => {
  assert.ok([401, 403].includes((await POST(request("POST", { content: "unauthorized", images: [image], imageCrops: { [image]: crop } }, false))).status));
});
