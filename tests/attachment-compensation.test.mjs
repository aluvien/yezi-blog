import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-attach-comp-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { createAttachment, db, getAttachment, createPost } = await import("../src/lib/db.ts");
const {
  clearUnusedAttachments,
  compressAttachmentById,
  compressUntrackedAttachmentByPath,
  deleteAttachmentById,
  deleteUntrackedAttachmentByPath,
} = await import("../src/lib/admin/attachments.ts");

const uploadDir = path.join(tempRoot, "data", "uploads", "202609");
fs.mkdirSync(uploadDir, { recursive: true });

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function createImageAttachment(name) {
  const absolute = path.join(uploadDir, name);
  const buffer = await writeImageFile(name);
  const attachment = createAttachment({
    path: `/uploads/202609/${name}`,
    original_name: name,
    mime_type: "image/png",
    size: buffer.length,
  });
  return { absolute, attachment, buffer };
}

async function writeImageFile(name) {
  const buffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 120, b: 60 } },
  }).png({ compressionLevel: 1 }).toBuffer();
  fs.writeFileSync(path.join(uploadDir, name), buffer);
  return buffer;
}

function leftoverQuarantineFiles() {
  return fs.readdirSync(uploadDir).filter((name) => name.startsWith("."));
}

test("happy path: compress updates file and DB together, delete removes both without quarantine leftovers", async () => {
  const { absolute, attachment } = await createImageAttachment("happy.png");
  const compressed = await compressAttachmentById(attachment.id, "small");
  assert.equal(compressed.ok, true);
  const row = getAttachment(attachment.id);
  assert.equal(Number(row.size), fs.statSync(absolute).size, "数据库大小必须与压缩后的文件一致");
  assert.deepEqual(leftoverQuarantineFiles(), []);

  const deleted = await deleteAttachmentById(attachment.id);
  assert.equal(deleted.ok, true);
  assert.equal(getAttachment(attachment.id), undefined);
  assert.equal(fs.existsSync(absolute), false);
  assert.deepEqual(leftoverQuarantineFiles(), []);
});

test("fault injection: quarantine move failure aborts delete and keeps the DB row", async () => {
  const { absolute, attachment } = await createImageAttachment("move-fail.png");
  const originalRename = fs.promises.rename;
  fs.promises.rename = async () => {
    const error = new Error("injected EACCES");
    error.code = "EACCES";
    throw error;
  };
  try {
    const result = await deleteAttachmentById(attachment.id);
    assert.equal(result.ok, false);
    assert.ok(getAttachment(attachment.id), "文件无法隔离时不得先删数据库记录");
    assert.equal(fs.existsSync(absolute), true);
  } finally {
    fs.promises.rename = originalRename;
  }
});

test("fault injection: swap failure after backup restores the original image", async () => {
  const { absolute, attachment, buffer } = await createImageAttachment("swap-fail.png");
  const originalRename = fs.promises.rename;
  let phase = 0;
  fs.promises.rename = async (from, to) => {
    // 第一次 rename 是原图→备份（放行），第二次是压缩图→原路径（注入失败）。
    phase += 1;
    if (phase === 2) {
      const error = new Error("injected EXDEV");
      error.code = "EXDEV";
      throw error;
    }
    return originalRename(from, to);
  };
  try {
    const result = await compressAttachmentById(attachment.id, "small");
    assert.equal(result.ok, false);
    assert.deepEqual(Buffer.compare(fs.readFileSync(absolute), buffer), 0, "替换失败后原图必须回到原路径");
    assert.equal(Number(getAttachment(attachment.id).size), buffer.length, "数据库大小不能被失败的压缩改写");
  } finally {
    fs.promises.rename = originalRename;
  }
  assert.deepEqual(leftoverQuarantineFiles(), [], "恢复路径不应留下隔离文件");
});

test("fault injection: non-EACCES restore failure still reports the backup path", async () => {
  const { absolute, attachment } = await createImageAttachment("restore-fail.png");
  const originalRename = fs.promises.rename;
  let phase = 0;
  fs.promises.rename = async (from, to) => {
    phase += 1;
    // 1=原图→备份放行；2=替换失败；3/4=两次恢复尝试都失败（非 EACCES）。
    if (phase >= 2) {
      const error = new Error("injected EXDEV");
      error.code = "EXDEV";
      throw error;
    }
    return originalRename(from, to);
  };
  try {
    const result = await compressAttachmentById(attachment.id, "small");
    assert.equal(result.ok, false);
    assert.match(String(result.error), /恢复失败/);
    const backups = leftoverQuarantineFiles();
    assert.equal(backups.length, 1, "恢复失败时备份必须留在磁盘");
    assert.ok(String(result.error).includes(backups[0]), "错误信息必须给出备份文件路径");
    assert.equal(fs.existsSync(absolute), false, "原路径此时为空（原图仍在备份名中）");
  } finally {
    fs.promises.rename = originalRename;
  }
  // 清理：把备份移回原位并删除，恢复测试目录整洁。
  const [backup] = leftoverQuarantineFiles();
  if (backup) fs.renameSync(path.join(uploadDir, backup), absolute);
  await deleteAttachmentById(attachment.id);
  assert.deepEqual(leftoverQuarantineFiles(), []);
});

test("fault injection: DB delete failure plus failed restore must report the quarantine path, not success", async () => {
  const { absolute, attachment } = await createImageAttachment("double-fail-delete.png");
  const Database = (await import("better-sqlite3")).default;
  const locker = new Database(path.join(tempRoot, "data", "blog.db"));
  locker.pragma("busy_timeout = 0");
  locker.exec("BEGIN EXCLUSIVE");
  const originalRename = fs.promises.rename;
  fs.promises.rename = async (from, to) => {
    // 放行“原文件→隔离”，让“隔离→原位”的恢复注入失败。
    if (path.basename(String(to)) === "double-fail-delete.png") {
      const error = new Error("injected EACCES");
      error.code = "EACCES";
      throw error;
    }
    return originalRename(from, to);
  };
  try {
    const result = await deleteAttachmentById(attachment.id);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /恢复失败/);
    assert.ok(getAttachment(attachment.id), "数据库锁释放后记录必须仍在（删除被拒绝）");
    const quarantined = leftoverQuarantineFiles();
    assert.equal(quarantined.length, 1, "恢复失败时隔离副本必须留在磁盘上");
    assert.ok(String(result.error).includes(quarantined[0]), "错误信息必须指出隔离文件位置");
  } finally {
    fs.promises.rename = originalRename;
    locker.exec("ROLLBACK");
    locker.close();
  }
  // 清理：手动把隔离文件放回并删除记录，避免影响 leftover 断言之外的状态。
  const [quarantined] = leftoverQuarantineFiles();
  if (quarantined) fs.renameSync(path.join(uploadDir, quarantined), absolute);
  await deleteAttachmentById(attachment.id);
});

test("untracked files and bulk cleanup share the same quarantine discipline", async () => {
  assert.equal((await deleteUntrackedAttachmentByPath("/uploads/202609/ghost.png")).error, "目录附件不存在");
  assert.equal((await compressUntrackedAttachmentByPath("/uploads/202609/ghost.png")).error, "目录中的附件不存在");

  // 未入库的磁盘文件：扫描后应作为 untracked 出现并可安全删除。
  await writeImageFile("stray.png");
  const strayAbsolute = path.join(uploadDir, "stray.png");
  assert.equal((await compressUntrackedAttachmentByPath("/uploads/202609/stray.png", "nonsense")).error, "压缩级别无效");
  assert.equal((await deleteUntrackedAttachmentByPath("/uploads/202609/stray.png")).ok, true);
  assert.equal(fs.existsSync(strayAbsolute), false);
  assert.deepEqual(leftoverQuarantineFiles(), []);

  // 被文章引用的 untracked 文件必须拒绝删除。
  await writeImageFile("used.png");
  const usedAbsolute = path.join(uploadDir, "used.png");
  createPost({ title: "引用了目录文件", content: "看图 ![u](/uploads/202609/used.png)", category: "随笔", status: "published" });
  assert.equal((await deleteUntrackedAttachmentByPath("/uploads/202609/used.png")).error, "附件正在网站中使用，请先移除引用");

  // 批量清理：未引用的入库附件与未入库文件删除，被引用的（含上面这张）保留。
  const keepAbsolute = path.join(uploadDir, "referenced.png");
  await writeImageFile("referenced.png");
  const tracked = createAttachment({ path: "/uploads/202609/referenced.png", original_name: "referenced.png", mime_type: "image/png", size: 1 });
  createPost({ title: "第二篇引用", content: `![](/uploads/202609/referenced.png)`, category: "随笔", status: "published" });
  const doomedAbsolute = path.join(uploadDir, "doomed.png");
  await writeImageFile("doomed.png");
  const doomed = createAttachment({ path: "/uploads/202609/doomed.png", original_name: "doomed.png", mime_type: "image/png", size: 1 });

  const cleanup = await clearUnusedAttachments();
  assert.equal(cleanup.ok, true);
  assert.ok(cleanup.data.deletedCount >= 2);
  assert.equal(getAttachment(doomed.id), undefined);
  assert.equal(fs.existsSync(doomedAbsolute), false);
  assert.ok(getAttachment(tracked.id), "被引用附件不得被清理");
  assert.equal(fs.existsSync(keepAbsolute), true);
  assert.equal(fs.existsSync(usedAbsolute), true);
  assert.deepEqual(leftoverQuarantineFiles(), []);
});
