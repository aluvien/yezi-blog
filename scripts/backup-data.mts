import { runCompleteDataBackup } from "../src/lib/data-backup.ts";

const result = await runCompleteDataBackup();
console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
