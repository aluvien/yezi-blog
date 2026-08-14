import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicRemoteUrl, isBlockedNetworkAddress } from "../src/lib/remote-url.ts";

test("blocks private, loopback and special-use network addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.0.8",
    "198.18.0.1",
    "203.0.113.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ]) {
    assert.equal(isBlockedNetworkAddress(address), true, address);
  }
});

test("allows ordinary public IP addresses", () => {
  assert.equal(isBlockedNetworkAddress("8.8.8.8"), false);
  assert.equal(isBlockedNetworkAddress("2001:4860:4860::8888"), false);
});

test("rejects unsafe remote URL forms before a request is made", async () => {
  await assert.rejects(assertPublicRemoteUrl("http://127.0.0.1/"), /不允许读取/);
  await assert.rejects(assertPublicRemoteUrl("http://localhost/"), /不允许读取/);
  await assert.rejects(assertPublicRemoteUrl("http://[::1]/"), /不允许读取/);
  await assert.rejects(assertPublicRemoteUrl("http://169.254.169.254/latest/meta-data/"), /不允许读取/);
  await assert.rejects(assertPublicRemoteUrl("file:///etc/passwd"), /只支持 http 或 https/);
  await assert.rejects(assertPublicRemoteUrl("https://user:pass@example.com/"), /不允许读取/);
});
