import fs from "node:fs";
import path from "node:path";

export type QQMusicSession = {
  cookie: string;
  uin: string;
  updatedAt: string;
};

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
    return { cookie: parsed.cookie, uin: parsed.uin, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "" };
  } catch {
    return null;
  }
}

/**
 * Persist atomically next to the database, never in Git or browser storage.
 * `mode` and chmod protect the file even if the process umask is permissive.
 */
export function saveQQMusicSession(session: Pick<QQMusicSession, "cookie" | "uin">): void {
  if (!validCookie(session.cookie) || !validUin(session.uin)) throw new Error("QQ 音乐登录信息无效");
  const destination = sessionPath();
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* rename already consumed it */ }
  }
}
