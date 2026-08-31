import crypto from "node:crypto";
import fs from "node:fs";

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest()));
  });
}

/**
 * Two SQLite online backups represent the same committed database state only
 * when their full contents match. Comparing backup files rather than blog.db
 * itself is important in WAL mode, where recent writes can exist solely in
 * blog.db-wal and leave the main database file unchanged.
 */
export async function databaseSnapshotsMatch(beforePath, afterPath) {
  const [before, after] = await Promise.all([hashFile(beforePath), hashFile(afterPath)]);
  return before.length === after.length && crypto.timingSafeEqual(before, after);
}
