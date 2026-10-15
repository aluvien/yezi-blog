import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type QQMusicNativeAuth = {
  token: string;
  credential: Record<string, unknown>;
  device: Record<string, unknown>;
  expiresAt: number;
};

export type QQMusicSession = {
  cookie: string;
  uin: string;
  updatedAt: string;
  revision?: string;
  nativeAuth?: QQMusicNativeAuth;
  credential?: Record<string, unknown>;
  refreshedAt?: string;
  lastRefreshAttemptAt?: string;
};

export type QQMusicSessionInput = Omit<QQMusicSession, "updatedAt" | "revision">;

export function validQQMusicNativeAuth(value: unknown): value is QQMusicNativeAuth {
  if (!value || typeof value !== "object") return false;
  const auth = value as QQMusicNativeAuth;
  return typeof auth.token === "string" && /^[a-f0-9]{64}$/i.test(auth.token)
    && Boolean(auth.credential && typeof auth.credential === "object" && !Array.isArray(auth.credential))
    && Boolean(auth.device && typeof auth.device === "object" && !Array.isArray(auth.device))
    && Number.isFinite(auth.expiresAt) && auth.expiresAt > 0;
}

function sessionPath(): string {
  const configured = process.env.QQ_MUSIC_SESSION_PATH?.trim();
  if (configured) return path.resolve(configured);
  const dbPath = process.env.BLOG_DB_PATH?.trim();
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(process.cwd(), "data");
  return path.join(dataDir, "qq-music-session.json");
}

function validCookie(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 16_000;
}

function validUin(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,16}$/.test(value);
}

/** Read the server-only QQ login session. Invalid or missing files act as logged out. */
export function getQQMusicSession(): QQMusicSession | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(), "utf8")) as Partial<QQMusicSession>;
    if (!validCookie(parsed.cookie) || !validUin(parsed.uin)) return null;
    return {
      cookie: parsed.cookie, uin: parsed.uin,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      ...(typeof parsed.revision === "string" ? { revision: parsed.revision } : {}),
      ...(validQQMusicNativeAuth(parsed.nativeAuth) ? { nativeAuth: parsed.nativeAuth } : {}),
      ...(parsed.credential && typeof parsed.credential === "object" && !Array.isArray(parsed.credential) ? { credential: parsed.credential } : {}),
      ...(typeof parsed.refreshedAt === "string" ? { refreshedAt: parsed.refreshedAt } : {}),
      ...(typeof parsed.lastRefreshAttemptAt === "string" ? { lastRefreshAttemptAt: parsed.lastRefreshAttemptAt } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Persist atomically next to the database, never in Git or browser storage.
 * `mode` and chmod protect the file even if the process umask is permissive.
 */
export function saveQQMusicSession(session: QQMusicSessionInput, epoch = currentDataEpoch()): void {
  const rejected = dataWriteRejection(epoch);
  if (rejected) throw new Error(rejected);
  if (!validCookie(session.cookie) || !validUin(session.uin)) throw new Error("QQ 音乐登录信息无效");
  const destination = sessionPath();
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ ...session, revision: randomUUID(), updatedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* rename already consumed it */ }
  }
}

export function updateQQMusicSession(expected: QQMusicSession, changes: Partial<QQMusicSessionInput>, epoch: string): boolean {
  if (dataWriteRejection(epoch)) return false;
  const current = getQQMusicSession();
  if (!current || current.cookie !== expected.cookie || current.updatedAt !== expected.updatedAt || current.revision !== expected.revision) return false;
  saveQQMusicSession({ ...current, ...changes }, epoch);
  return true;
}
