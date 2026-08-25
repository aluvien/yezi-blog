import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicWriteRequest, validateSameOriginWrite } from "../src/lib/request-security.ts";

function request(headers, method = "POST") {
  return new Request("https://yezi.test/api/write", { method, headers, body: "{}" });
}

test("browser writes require JSON and an exact same origin", () => {
  assert.equal(validatePublicWriteRequest(request({ "content-type": "application/json", origin: "https://yezi.test" })), null);
  assert.equal(validatePublicWriteRequest(request({ "content-type": "text/plain", origin: "https://yezi.test" }))?.status, 415);
  assert.equal(validatePublicWriteRequest(request({ "content-type": "application/json", origin: "https://evil.test" }))?.status, 403);
  assert.equal(validatePublicWriteRequest(request({ "content-type": "application/json", origin: "https://yezi.test", "sec-fetch-site": "cross-site" }))?.status, 403);
});

test("native non-simple visitor requests remain supported without weakening browser CSRF", () => {
  assert.equal(validatePublicWriteRequest(request({
    "content-type": "application/json",
    "x-yezi-visitor-id": "9a3c22ec-b9e2-4a99-8842-4e11b2b1391c",
  })), null);
  assert.equal(validatePublicWriteRequest(request({ "content-type": "application/json" }))?.status, 403);
});

test("cookie admin writes also require the explicit CSRF header", () => {
  assert.equal(validateSameOriginWrite(request({ "content-type": "application/json", origin: "https://yezi.test" }), { requireCsrfHeader: true })?.status, 403);
  assert.equal(validateSameOriginWrite(request({ "content-type": "application/json", origin: "https://yezi.test", "x-yezi-csrf": "1" }), { requireCsrfHeader: true }), null);
});
