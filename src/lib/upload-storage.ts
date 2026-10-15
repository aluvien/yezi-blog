import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import { withDataFileMutation } from "@/lib/data-files-lock";
import { promises as fs } from "node:fs";
import path from "node:path";

/** File, record and compensation share the restore/backup lease. Capture epoch before parsing a request. */
export async function writeUploadWithRecord<T>(absolutePath: string, contents: Buffer, createRecord: () => T, epoch = currentDataEpoch()): Promise<T> {
  return withDataFileMutation(async () => {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    // Generated names must never overwrite an existing upload.
    const handle = await fs.open(absolutePath, "wx", 0o640);
    try {
      await handle.writeFile(contents);
      const rejected = dataWriteRejection(epoch);
      if (rejected) throw new Error(rejected);
      return createRecord();
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    } finally { await handle.close(); }
  }, epoch);
}
