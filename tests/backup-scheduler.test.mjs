import test from "node:test";
import assert from "node:assert/strict";
import { backupRetryDelay, isDatabaseNotInitializedError } from "../src/lib/backup-scheduler.ts";

test("a fresh deployment retries a missing database soon without masking real backup errors", () => {
  const normalDelay = 12 * 60 * 60 * 1000;
  const missing = new Error("数据库不存在：/temporary/data/blog.db");
  assert.equal(isDatabaseNotInitializedError(missing), true);
  assert.equal(backupRetryDelay(missing, normalDelay), 60_000);
  assert.equal(backupRetryDelay(new Error("磁盘写入失败"), normalDelay), normalDelay);
});
