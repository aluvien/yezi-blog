import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProjectRoot } from "@/lib/uploads";
import { normalizeWebDavLocation, type WebDavConfig } from "@/lib/webdav";
import { cloudBackupSiteLabel } from "@/lib/cloud-backup-name";
import type { CloudBackupSettings } from "@/lib/cloud-backup-types";

export type StoredCloudSettings = WebDavConfig & { format: 1; key: string; version: string; dailyEnabled: boolean; keep: number };
export function cloudBackupRoot(): string {
  const directory = path.join(getProjectRoot(), "data", "backups", "cloud");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory()) throw new Error("云备份目录不可用。");
  fs.chmodSync(directory, 0o700);
  return directory;
}
export function writePrivateJson(file: string, value: unknown): void {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}
export function readCloudSettings(): StoredCloudSettings | null {
  const file = path.join(cloudBackupRoot(), "settings.json");
  if (!fs.existsSync(file)) return null;
  const settings = JSON.parse(fs.readFileSync(file, "utf8")) as StoredCloudSettings;
  if (settings.format !== 1 || typeof settings.password !== "string" || !validRecoveryKey(settings.key)) throw new Error("云备份配置损坏，请重新配置。");
  normalizeWebDavLocation(settings.endpoint, settings.directory);
  return settings;
}
export function publicCloudSettings(): CloudBackupSettings {
  const settings = readCloudSettings();
  return settings ? { siteLabel: cloudBackupSiteLabel(), endpoint: settings.endpoint, username: settings.username, directory: settings.directory, dailyEnabled: settings.dailyEnabled, keep: settings.keep, hasPassword: Boolean(settings.password), hasKey: true }
    : { siteLabel: cloudBackupSiteLabel(), endpoint: "", username: "", directory: "backup", dailyEnabled: false, keep: 14, hasPassword: false, hasKey: false };
}
export function validRecoveryKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32;
}
export function saveCloudSettings(input: Record<string, unknown>): CloudBackupSettings {
  const keys = ["endpoint", "username", "password", "directory", "dailyEnabled", "keep", "recoveryKey"];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("云备份配置包含未知字段。");
  if (typeof input.endpoint !== "string" || typeof input.username !== "string" || typeof input.directory !== "string" || typeof input.dailyEnabled !== "boolean" || !Number.isInteger(input.keep) || Number(input.keep) < 1 || Number(input.keep) > 100) throw new Error("请输入有效的云备份配置，保留份数须为 1–100。");
  const previous = readCloudSettings();
  const username = input.username.trim();
  if (previous && (!input.password || input.password === "") && (username !== previous.username || new URL(input.endpoint).origin !== new URL(previous.endpoint).origin)) throw new Error("请输入密码：域名或账号变更后需要重新填写密码。");
  const password = input.password === undefined || input.password === "" ? previous?.password : input.password;
  if (!username || username.length > 200 || /[:\r\n\x00]/.test(username) || typeof password !== "string" || !password || password.length > 2000 || /[\r\n\x00]/.test(password)) throw new Error("请输入有效的 WebDAV 账号和密码。");
  const key = input.recoveryKey === undefined || input.recoveryKey === "" ? previous?.key ?? crypto.randomBytes(32).toString("base64") : input.recoveryKey;
  if (!validRecoveryKey(key)) throw new Error("恢复密钥必须是 32 字节密钥的 base64 编码，请使用导出的密钥文件。");
  const location = normalizeWebDavLocation(input.endpoint, input.directory);
  const settings: StoredCloudSettings = { format: 1, ...location, username, password, key, version: crypto.randomUUID(), dailyEnabled: input.dailyEnabled, keep: Number(input.keep) };
  writePrivateJson(path.join(cloudBackupRoot(), "settings.json"), settings);
  return publicCloudSettings();
}
export function requireCloudSettings(): StoredCloudSettings {
  const settings = readCloudSettings();
  if (!settings) throw new Error("请先保存云备份配置。");
  return settings;
}
