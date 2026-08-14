// 站点设置 DAO。
import { db, now } from "./core";

export function getSiteSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM site_settings ORDER BY key ASC").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setSiteSettings(values: Record<string, string>): void {
  const statement = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const transaction = db.transaction((entries: Array<[string, string]>) => {
    const timestamp = now();
    for (const [key, value] of entries) statement.run(key, value, timestamp);
  });
  transaction(Object.entries(values).map(([key, value]) => [key.trim(), String(value ?? "")]));
}
