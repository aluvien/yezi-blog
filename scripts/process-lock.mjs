import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OWNER = /^owner-[0-9a-f-]{36}\.json$/;
const LEGACY_GRACE_MS = 60_000;

function processIdentity(pid) {
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      return `${fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${start}`;
    }
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
}

function ownerAlive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return true;
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code !== "ESRCH"; }
  const actual = owner.identity && processIdentity(owner.pid);
  // Missing permission/identity is not evidence that the owner has exited.
  return !actual || actual === owner.identity;
}

/** Old versions kept an open fd for the full operation but wrote no PID. */
function legacyOwnerAlive(file, stat) {
  if (Date.now() - stat.mtimeMs < LEGACY_GRACE_MS) return true;
  if (process.platform === "linux") {
    try {
      for (const pid of fs.readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
        try {
          // An exclusively created legacy lock belongs to its creator's uid.
          if (fs.statSync(`/proc/${pid}`).uid !== stat.uid) continue;
          for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
            try {
              const open = fs.statSync(`/proc/${pid}/fd/${fd}`);
              if (open.dev === stat.dev && open.ino === stat.ino) return true;
            } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) return true; }
          }
        } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) return true; }
      }
      return false;
    } catch { return true; }
  }
  try {
    return Boolean(execFileSync("lsof", ["-t", "--", file], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"] }).trim());
  } catch (error) {
    return !(error.status === 1 && !String(error.stdout || "").trim() && !String(error.stderr || "").trim());
  }
}

function removeOwner(file, name) {
  try { fs.unlinkSync(path.join(file, name)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // A concurrent successor is published with its own owner already inside.
  // rmdir cannot delete it, unlike unlinking a shared empty lock file.
  try { fs.rmdirSync(file); }
  catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
}

/** Reclaim only a proven departed owner. Age alone never expires a live job. */
export function isProcessLockBusy(file) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (stat.isFile()) {
    if (legacyOwnerAlive(file, stat)) return true;
    try {
      const current = fs.lstatSync(file);
      if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev) return true;
      fs.unlinkSync(file);
    } catch (error) { if (error.code !== "ENOENT") return true; }
    return false;
  }
  if (!stat.isDirectory()) return true;
  let names;
  try { names = fs.readdirSync(file); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  // Published locks always contain exactly one fully written owner record.
  if (names.length === 0) {
    try { fs.rmdirSync(file); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
    return fs.existsSync(file);
  }
  if (names.length !== 1 || !OWNER.test(names[0])) return true;
  let owner;
  try { owner = JSON.parse(fs.readFileSync(path.join(file, names[0]), "utf8")); }
  catch { return fs.existsSync(file); }
  if (ownerAlive(owner)) return true;
  removeOwner(file, names[0]);
  return fs.existsSync(file);
}

/** @returns {{ file: string, owner: string }} */
export function acquireProcessLock(file, message = "已有任务正在执行") {
  const owner = `owner-${crypto.randomUUID()}.json`;
  const temporary = `${file}.claim-${crypto.randomUUID()}`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(temporary, owner), JSON.stringify({ pid: process.pid, identity: processIdentity(process.pid) }), { mode: 0o600 });
    for (let attempt = 0; attempt < 3; attempt++) {
      if (isProcessLockBusy(file)) throw new Error(message);
      try {
        fs.renameSync(temporary, file);
        return { file, owner };
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(error.code)) throw error;
      }
    }
    throw new Error(message);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Only remove this acquisition's unique owner, never a successor's lock. */
export function releaseProcessLock(lock) {
  if (lock) removeOwner(lock.file, lock.owner);
}
