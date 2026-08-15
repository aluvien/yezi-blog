import { verifyDatabaseBackup } from "../src/lib/backup-verification.ts";

const inputPath = process.argv[2]?.trim();
if (!inputPath) {
  console.error("用法：npm run backup:verify -- /absolute/path/to/blog-YYYYMMDDHHMMSS.db");
  process.exitCode = 2;
} else {
  try {
    const verification = verifyDatabaseBackup(inputPath);
    console.log(JSON.stringify({ status: "ok", ...verification }, null, 2));
  } catch (error) {
    console.error(`备份校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
