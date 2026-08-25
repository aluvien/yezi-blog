import { verifyCompleteDataBackup } from "../src/lib/data-backup.ts";

const input = process.argv[2];
if (!input) throw new Error("用法：npm run backup:data:verify -- /absolute/path/to/data-*.tar.gz.enc");
console.log(JSON.stringify({ status: "ok", ...await verifyCompleteDataBackup(input) }, null, 2));
