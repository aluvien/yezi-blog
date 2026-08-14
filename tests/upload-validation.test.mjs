import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ALLOWED_UPLOAD_TYPES, hasSafeImageDimensions, hasValidUploadSignature, MAX_UPLOAD_SIZE } from "../src/lib/upload-validation.ts";
import { writeUploadWithRecord } from "../src/lib/upload-storage.ts";

test("upload allow-list accepts supported MIME types and rejects an unknown type", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "application/zip", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
    assert.ok(ALLOWED_UPLOAD_TYPES[mime], mime);
  }
  assert.equal(ALLOWED_UPLOAD_TYPES["image/svg+xml"], undefined);
  assert.equal(ALLOWED_UPLOAD_TYPES["application/javascript"], undefined);
  assert.equal(MAX_UPLOAD_SIZE, 20 * 1024 * 1024);
});

test("binary MIME claims require matching magic bytes", () => {
  const fixtures = [
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/webp", Buffer.from("RIFFxxxxWEBP", "ascii")],
    ["image/gif", Buffer.from("GIF89a", "ascii")],
    ["application/pdf", Buffer.from("%PDF-1.7", "ascii")],
    ["application/zip", Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ["application/msword", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  ];
  for (const [mime, bytes] of fixtures) assert.equal(hasValidUploadSignature(mime, bytes), true, mime);
  assert.equal(hasValidUploadSignature("image/png", Buffer.from("not a png")), false);
  assert.equal(hasValidUploadSignature("application/pdf", Buffer.from("<script>alert(1)</script>")), false);
});

test("DOCX cannot be spoofed with an arbitrary ZIP container", () => {
  const zipOnly = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("archive.txt")]);
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("[Content_Types].xmlword/document.xml")]);
  assert.equal(hasValidUploadSignature("application/zip", zipOnly), true);
  assert.equal(hasValidUploadSignature("application/vnd.openxmlformats-officedocument.wordprocessingml.document", zipOnly), false);
  assert.equal(hasValidUploadSignature("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx), true);
});

test("image dimension guard rejects pixel bombs before image transformation", () => {
  assert.equal(hasSafeImageDimensions(6_000, 10_000), true);
  assert.equal(hasSafeImageDimensions(6_300, 10_000), false);
  assert.equal(hasSafeImageDimensions(undefined, 100), false);
});

test("database record failures remove the file that was just written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-upload-"));
  const failedPath = path.join(dir, "failed.bin");
  const savedPath = path.join(dir, "saved.bin");
  try {
    await assert.rejects(
      writeUploadWithRecord(failedPath, Buffer.from("payload"), () => {
        throw new Error("database unavailable");
      }),
      /database unavailable/,
    );
    assert.equal(fs.existsSync(failedPath), false);
    assert.deepEqual(await writeUploadWithRecord(savedPath, Buffer.from("payload"), () => ({ id: 1 })), { id: 1 });
    assert.equal(fs.readFileSync(savedPath, "utf8"), "payload");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
