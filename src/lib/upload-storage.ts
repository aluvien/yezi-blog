import { promises as fs } from "node:fs";

/** Write the file first, then remove it again if the database transaction cannot create its record. */
export async function writeUploadWithRecord<T>(absolutePath: string, contents: Buffer, createRecord: () => T): Promise<T> {
  try {
    await fs.writeFile(absolutePath, contents, { mode: 0o640 });
  } catch (error) {
    // 磁盘写满或进程中断时 writeFile 仍可能留下部分文件，不能让它成为永久孤儿。
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
  try {
    return createRecord();
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}
