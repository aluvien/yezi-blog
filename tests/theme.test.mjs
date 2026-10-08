import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_THEMES, normalizeLayoutTheme } from "../src/lib/theme.ts";

test("only the classic layout remains available", () => {
  assert.deepEqual(LAYOUT_THEMES.map(layout => layout.id), ["classic"]);
});

test("retired and unknown layouts fall back to classic", () => {
  for (const value of ["editorial", "classic", "unknown", "", undefined]) {
    assert.equal(normalizeLayoutTheme(value), "classic");
  }
});
