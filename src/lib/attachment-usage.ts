import type Database from "better-sqlite3";
import type { AttachmentReference } from "@/lib/db/types";

type Source = { reference: AttachmentReference; values: string[] };
type Row = Record<string, string | number | null>;

/** Older backups may predate a table/column; inspect without migrating the snapshot. */
function rows(database: Database.Database, table: string, columns: string[]): Row[] {
  const available = new Set((database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(column => column.name));
  if (!available.size) return [];
  const select = columns.map(column => available.has(column) ? `"${column}"` : `NULL AS "${column}"`).join(",");
  return database.prepare(`SELECT ${select} FROM "${table}"`).all() as Row[];
}

/** Register every visible local media source here, shared by cleanup and backup checks. */
export function attachmentSources(database: Database.Database): Source[] {
  const result: Source[] = [];
  const add = (reference: AttachmentReference, ...values: unknown[]) => result.push({ reference, values: values.filter((v): v is string => typeof v === "string" && Boolean(v)) });
  for (const row of rows(database, "posts", ["id", "title", "slug", "content", "cover"])) {
    const ref = { type: "post" as const, id: Number(row.id), label: String(row.title), slug: String(row.slug) };
    add({ ...ref, usage: "content" }, row.content);
    add({ ...ref, usage: "cover" }, row.cover);
  }
  for (const row of rows(database, "moments", ["id", "content", "images"])) add({ type: "moment", id: Number(row.id), label: String(row.content ?? "").replace(/\s+/g, " ").slice(0, 30) || "絮语" }, row.content, row.images);
  for (const row of rows(database, "life_events", ["id", "title", "content", "cover", "images"])) add({ type: "life_event", id: Number(row.id), label: String(row.title) }, row.content, row.cover, row.images);
  for (const row of rows(database, "works", ["id", "title", "description", "cover"])) add({ type: "work", id: Number(row.id), label: String(row.title) }, row.description, row.cover);
  for (const row of rows(database, "github_repositories", ["id", "full_name", "custom_description", "cover"])) add({ type: "github_repository", id: Number(row.id), label: String(row.full_name) }, row.custom_description, row.cover);
  for (const table of ["reference_library", "article_references"]) {
    for (const row of rows(database, table, ["id", "title", "cover"])) add({ type: "reference", id: Number(row.id), label: String(row.title) }, row.cover);
  }
  for (const row of rows(database, "site_settings", ["key", "value"])) {
    const label = ({ site_logo: "站点 Logo", author_avatar: "作者头像", about_content: "关于页内容" } as Record<string, string>)[String(row.key)];
    if (label) add({ type: "setting", id: 0, label, usage: row.key === "about_content" ? "content" : "cover" }, row.value);
  }
  return result;
}

export function attachmentReferences(uploadPath: string, sources: Source[]): AttachmentReference[] {
  const result: AttachmentReference[] = [];
  for (const source of sources) {
    if (!source.values.some(value => {
      if (value.includes(uploadPath)) return true;
      try { return decodeURIComponent(value).includes(uploadPath); } catch { return false; }
    })) continue;
    const existing = result.find(ref => ref.type === source.reference.type && ref.id === source.reference.id && ref.label === source.reference.label);
    if (existing) { if (existing.type === "post" && existing.usage !== source.reference.usage) existing.usage = "content+cover"; }
    else result.push({ ...source.reference });
  }
  return result;
}

/** Ignore code examples and externally hosted URLs; uploaded URLs are root relative. */
export function referencedUploadPaths(sources: Source[]): string[] {
  const paths = new Set<string>();
  for (const source of sources) for (const value of source.values) {
    const content = value.replace(/```(?!gallery\b)[^\n]*\n[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
    for (const match of content.matchAll(/(?:https?:\/\/[^\s<>"'`\\)\]}]+)|(?:\/uploads\/[^\s<>"'`\\)\]}]+)/g)) {
      if (!match[0].startsWith("/uploads/")) continue;
      try { paths.add(decodeURIComponent(match[0].split(/[?#]/)[0])); } catch { /* Invalid URLs cannot reference a local file. */ }
    }
  }
  return [...paths];
}
