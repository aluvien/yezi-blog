import assert from "node:assert/strict";
import test from "node:test";
import { groupMomentImages } from "../src/lib/moments.ts";

test("moment images use balanced rows for every supported image count", () => {
  const expected = {
    1: [1],
    2: [2],
    3: [3],
    4: [2, 2],
    5: [2, 3],
    6: [3, 3],
    7: [2, 2, 3],
    8: [2, 3, 3],
    9: [3, 3, 3],
  };

  for (const [count, rowSizes] of Object.entries(expected)) {
    const images = Array.from({ length: Number(count) }, (_, index) => `image-${index + 1}`);
    const rows = groupMomentImages(images);
    assert.deepEqual(rows.map((row) => row.length), rowSizes);
    assert.deepEqual(rows.flat(), images);
  }
});

test("moment image grouping caps the lightbox set at nine images", () => {
  const images = Array.from({ length: 12 }, (_, index) => index);
  assert.deepEqual(groupMomentImages(images).flat(), images.slice(0, 9));
});
