// 站点设置 DAO。
import { db, now } from "./core";
import { normalizeLayoutTheme } from "@/lib/theme";

/**
 * 读取站点设置的统一边界。layout_theme 在这里就完成规范化：空库、旧库或
 * 非法值一律回退默认版式，避免调用方各自比较原始字符串而出现
 * “声明是经典版、渲染成现代版”的混合主题。
 */
export function getSiteSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM site_settings ORDER BY key ASC").all() as Array<{ key: string; value: string }>;
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  settings.layout_theme = normalizeLayoutTheme(settings.layout_theme);
  return settings;
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
