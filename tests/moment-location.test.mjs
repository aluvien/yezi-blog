import test from "node:test";
import assert from "node:assert/strict";

const { cityFromReverseGeocode, normalizeMomentLocation } = await import("../src/lib/moment-location.ts");

test("moment location stores only a short normalized display label", () => {
  assert.equal(normalizeMomentLocation("  浙江省\n杭州市  "), "浙江省 杭州市");
  assert.equal(normalizeMomentLocation("x".repeat(81)), null);
  assert.equal(normalizeMomentLocation(120.2), null);
});

test("reverse geocoding chooses a city-level address component", () => {
  assert.equal(cityFromReverseGeocode({ address: { suburb: "西湖区", city: "杭州市", province: "浙江省" } }), "杭州市");
  assert.equal(cityFromReverseGeocode({ address: { municipality: "北京市", county: "海淀区" } }), "北京市");
  assert.equal(cityFromReverseGeocode({ address: { suburb: "西湖区" } }), "");
});
