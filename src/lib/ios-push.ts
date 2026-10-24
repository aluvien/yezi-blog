import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/core";
import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import { isDeploymentWriteHoldActive } from "@/lib/deploy-write-guard";
import { pushConfiguration, sendAPNs, type PushEnvironment, type PushResult } from "@/lib/apns";

type Device = { installation_id: string; token: string; environment: PushEnvironment; site_root: string; session_id: string; comments: number; music: number; enabled: number };
export type PushRegistration = { installation_id: string; token: string; environment: PushEnvironment; site_root: string; comments: boolean; music: boolean };
export type PushEvent = { key: string; kind: "comment" | "music_expired" | "test"; title: string; body: string; comment_id?: number };
const validID = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function parsePushRegistration(body: Record<string, unknown>): PushRegistration | null {
  if (!validID(body.installation_id) || typeof body.token !== "string" || !/^[a-f0-9]{32,512}$/i.test(body.token) || body.token.length % 2 ||
    !["development", "production"].includes(String(body.environment)) || typeof body.site_root !== "string" ||
    typeof body.comments !== "boolean" || typeof body.music !== "boolean") return null;
  let url: URL;
  try { url = new URL(body.site_root); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return { ...body, installation_id: body.installation_id.toLowerCase(), token: body.token.toLowerCase(), site_root: url.origin } as PushRegistration;
}

export function registerPushDevice(value: PushRegistration, sessionID: string): void {
  db.transaction(() => {
    // A rotated token must belong to only one installation. Pending events are not replayed after re-login.
    db.prepare("DELETE FROM push_devices WHERE token = ? AND environment = ? AND installation_id != ?").run(value.token, value.environment, value.installation_id);
    db.prepare(`DELETE FROM push_outbox WHERE installation_id=? AND state='pending' AND EXISTS
      (SELECT 1 FROM push_devices WHERE installation_id=? AND (token!=? OR environment!=? OR session_id!=?))`)
      .run(value.installation_id, value.installation_id, value.token, value.environment, sessionID);
    db.prepare(`INSERT INTO push_devices (installation_id, token, environment, site_root, session_id, comments, music, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET
      token=excluded.token, environment=excluded.environment, site_root=excluded.site_root, session_id=excluded.session_id,
      comments=excluded.comments, music=excluded.music, enabled=1, updated_at=excluded.updated_at`)
      .run(value.installation_id, value.token, value.environment, value.site_root, sessionID, Number(value.comments), Number(value.music), Date.now());
  })();
}

export function unregisterPushDevice(installationID: unknown, sessionID: string): boolean {
  if (!validID(installationID)) return false;
  db.transaction(() => {
    const changed = db.prepare("DELETE FROM push_devices WHERE installation_id = ? AND session_id = ?").run(installationID.toLowerCase(), sessionID).changes;
    if (changed) db.prepare("DELETE FROM push_outbox WHERE installation_id = ?").run(installationID.toLowerCase());
  })();
  return true;
}

function activeDevices(): Device[] {
  return db.prepare(`SELECT d.* FROM push_devices d JOIN sessions s ON d.session_id=s.id
    JOIN auth_state a ON a.singleton=1 WHERE d.enabled=1 AND s.expires_at>? AND s.generation=a.session_generation`)
    .all(Date.now()) as Device[];
}

export function enqueuePush(event: PushEvent, onlyInstallation?: string): number {
  if (dataWriteRejection(currentDataEpoch()) || isDeploymentWriteHoldActive()) return 0;
  const config = pushConfiguration();
  if (!config.configured) return 0;
  return db.transaction(() => {
    let count = 0;
    for (const device of activeDevices()) {
      if (device.site_root !== config.siteRoot || (onlyInstallation && device.installation_id !== onlyInstallation) ||
        (event.kind === "comment" && !device.comments) || (event.kind === "music_expired" && !device.music)) continue;
      const payload = JSON.stringify({ aps: { alert: { title: event.title.slice(0, 60), body: event.body.slice(0, 180) }, sound: "default", "thread-id": event.kind },
        yezi: { version: 1, event_id: event.key, kind: event.kind, site_root: device.site_root, ...(event.comment_id ? { comment_id: event.comment_id } : {}) } });
      count += db.prepare(`INSERT OR IGNORE INTO push_outbox (event_key,installation_id,payload,kind,created_at,next_attempt_at)
        VALUES (?,?,?,?,?,?)`).run(event.key, device.installation_id, payload, event.kind, Date.now(), Date.now()).changes;
    }
    return count;
  })();
}

/** One bounded batch. SQLite claims prevent parallel web workers from sending the same row. */
export async function drainPushOutbox(deliver: typeof sendAPNs = sendAPNs): Promise<void> {
  if (!pushConfiguration().configured || process.env.BLOG_BUILD_READONLY === "true" || isDeploymentWriteHoldActive()) return;
  const epoch = currentDataEpoch();
  if (dataWriteRejection(epoch)) return;
  db.prepare("DELETE FROM push_outbox WHERE created_at < ?").run(Date.now() - 7 * 86400000);
  for (let i = 0; i < 12; i++) {
    if (dataWriteRejection(epoch) || isDeploymentWriteHoldActive()) return;
    const row = db.transaction(() => {
      const candidate = db.prepare("SELECT * FROM push_outbox WHERE state='pending' AND next_attempt_at<=? ORDER BY id LIMIT 1").get(Date.now()) as
        { id: number; installation_id: string; payload: string; kind: string; attempts: number; created_at: number } | undefined;
      if (candidate) db.prepare("UPDATE push_outbox SET next_attempt_at=?, attempts=attempts+1 WHERE id=?").run(Date.now() + 120000, candidate.id);
      return candidate;
    })();
    if (!row) return;
    const device = activeDevices().find(d => d.installation_id === row.installation_id);
    if (!device || device.site_root !== pushConfiguration().siteRoot || (row.kind === "comment" && !device.comments) || (row.kind === "music_expired" && !device.music) || Date.now() - row.created_at > 3600000) {
      db.prepare("UPDATE push_outbox SET state='cancelled' WHERE id=?").run(row.id); continue;
    }
    let result: PushResult;
    try { result = await deliver(device.token, device.environment, row.payload); }
    catch { result = { accepted: false, retry: true, reason: "TransportError" }; }
    if (dataWriteRejection(epoch) || isDeploymentWriteHoldActive()) return;
    const state = result.accepted ? "sent" : result.retry && row.attempts < 7 ? "pending" : "failed";
    db.prepare("UPDATE push_outbox SET state=?,last_reason=?,next_attempt_at=? WHERE id=?")
      .run(state, result.reason, Date.now() + Math.min(900000, 30000 * 2 ** row.attempts), row.id);
    if (result.disable) db.prepare("UPDATE push_devices SET enabled=0 WHERE installation_id=? AND token=? AND environment=?")
      .run(device.installation_id, device.token, device.environment);
  }
}

export function enqueuePushTest(installationID: unknown, sessionID: string): "queued" | "rate_limited" | "missing" {
  if (!validID(installationID)) return "missing";
  const row = db.prepare("UPDATE push_devices SET last_test_at=? WHERE installation_id=? AND session_id=? AND enabled=1 AND last_test_at<?")
    .run(Date.now(), installationID.toLowerCase(), sessionID, Date.now() - 60000);
  if (!row.changes) return db.prepare("SELECT 1 FROM push_devices WHERE installation_id=? AND session_id=? AND enabled=1").get(installationID.toLowerCase(), sessionID) ? "rate_limited" : "missing";
  return enqueuePush({ key: `test:${randomUUID()}`, kind: "test", title: "叶子通知已连接", body: "新评论和 QQ 音乐登录失效时，会在这里提醒你。" }, installationID.toLowerCase()) ? "queued" : "missing";
}

/** Persist login incidents separately from Telegram delivery state and across process restarts. */
export function notifyMusicPushHealth(status: string, sessionVersion?: string, previousVersion?: string): void {
  if (!pushConfiguration().configured || dataWriteRejection(currentDataEpoch()) || isDeploymentWriteHoldActive()) return;
  db.transaction(() => {
    const previous = db.prepare("SELECT * FROM push_health_state WHERE name='qq' ").get() as { invalid: number; session_version?: string } | undefined;
    const version = sessionVersion || previous?.session_version || previousVersion;
    const provenInvalid = status === "expired" || status === "missing_session";
    const invalid = provenInvalid ? 1 : status === "healthy" ? 0 : previous?.invalid || 0;
    if (provenInvalid && version && (!previous?.invalid || previous.session_version !== version)) {
      enqueuePush({ key: `music:${randomUUID()}`, kind: "music_expired", title: "QQ 音乐登录已失效",
        body: "点击打开音乐设置，重新登录后即可恢复播放。" });
    }
    db.prepare(`INSERT INTO push_health_state (name,invalid,session_version) VALUES ('qq',?,?)
      ON CONFLICT(name) DO UPDATE SET invalid=excluded.invalid,session_version=excluded.session_version`).run(invalid, version || null);
  })();
}

let started = false;
export function startPushScheduler(): void {
  if (started || process.env.BLOG_BUILD_READONLY === "true") return;
  started = true;
  // No browser or mobile polling; reuse server lifecycle, retry only bounded due work.
  const timer = setInterval(() => { void drainPushOutbox().catch(() => console.warn("[push] delivery batch failed")); }, 60000);
  timer.unref();
}
