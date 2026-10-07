import { currentDataEpoch, isCloudRestoreActive } from "@/lib/cloud-restore-guard";
import { promises as fs } from "node:fs";

/** Write the file first, then remove it again if the database transaction cannot create its record. */
export async function writeUploadWithRecord<T>(absolutePath: string, contents: Buffer, createRecord: () => T): Promise<T> {
  if (isCloudRestoreActive()) throw new Error("正在恢复数据，请稍后上传文件");
  const epoch = currentDataEpoch();
  try {
    await fs.writeFile(absolutePath, contents, { mode: 0o640 });
  } catch (error) {
    // 磁盘写满或进程中断时 writeFile 仍可能留下部分文件，不能让它成为永久孤儿。
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
  try {
    if (isCloudRestoreActive() || currentDataEpoch() !== epoch) throw new Error("数据已进入恢复流程，请重新上传文件");
    return createRecord();
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}
