import test from "node:test";
import assert from "node:assert/strict";

const { qqMusicCredentialCookie, resolveNativeQQMusicDevicePath } = await import("../src/lib/qq-music-native-login.ts");
const { QQ_MUSIC_APP_SOURCE, withSource } = await import("../src/lib/service-source.ts");

test("native QQ Music credential becomes a sidecar-compatible cookie", () => {
  const result = qqMusicCredentialCookie({
    musicid: 12345678,
    str_musicid: "12345678",
    musickey: "secret-native-key",
    loginType: 6,
  });
  assert.deepEqual(result, {
    uin: "12345678",
    cookie: "uin=12345678; qqmusic_uin=12345678; qm_keyst=secret-native-key; qqmusic_key=secret-native-key; tmeLoginType=6",
  });
});

test("native credential conversion rejects missing or cookie-injectable values", () => {
  assert.equal(qqMusicCredentialCookie({ musicid: "12345678", musickey: "" }), null);
  assert.equal(qqMusicCredentialCookie({ musicid: "12345678", musickey: "bad; injected=1" }), null);
  assert.equal(qqMusicCredentialCookie({ musicid: "not-a-number", musickey: "key" }), null);
});

test("failure source annotation is explicit and idempotent", () => {
  const message = withSource("二维码生成失败", QQ_MUSIC_APP_SOURCE);
  assert.match(message, /u\.y\.qq\.com \/ mu\.y\.qq\.com/);
  assert.equal(withSource(message, QQ_MUSIC_APP_SOURCE), message);
});

test("native QR device path ignores non-string process-manager values", () => {
  const result = resolveNativeQQMusicDevicePath({
    QQ_MUSIC_NATIVE_DEVICE_PATH: 62079,
    BLOG_DB_PATH: 62080,
  }, "/srv/yezi");
  assert.equal(result, "/srv/yezi/data/qq-music-native-device.json");
});
