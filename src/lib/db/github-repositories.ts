// GitHub 仓库 DAO。核心约束：自动同步字段与手工展示字段（custom_*、cover、tags、
// featured）严格分离，任何同步路径都不会覆盖手工字段（见 applyGithubSyncResult）。
import { db, now } from "./core";
import type { GithubRepository } from "./types";
import type { GithubRepositoryMetadata } from "@/lib/github-api";
import { normalizePostTags } from "@/lib/post-tags";

function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const tag = String(item ?? "").trim().slice(0, 50);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 20) break;
  }
  return result;
}

function normalizeCover(value: unknown): string | null {
  const cover = String(value ?? "").trim();
  if (!cover) return null;
  if (cover.length > 2_000) return null;
  if (cover.startsWith("/uploads/") && !cover.startsWith("//")) return cover;
  return /^https?:\/\//i.test(cover) ? cover : null;
}

/** 登记新仓库。仅写入标识与少量手工字段；自动字段由后续同步填充。 */
export function registerGithubRepository(input: {
  owner: string;
  name: string;
  fullName: string;
  repoUrl: string;
  customTitle?: string;
  customDescription?: string;
  cover?: string | null;
  tags?: string[];
  featured?: boolean;
}): GithubRepository {
  const ts = now();
  db.prepare(`
    INSERT INTO github_repositories
      (owner, name, full_name, repo_url, custom_title, custom_description, cover, tags, featured, registered_at, sync_status, sync_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', '', ?)
  `).run(
    input.owner,
    input.name,
    input.fullName,
    input.repoUrl,
    String(input.customTitle ?? "").trim().slice(0, 240),
    String(input.customDescription ?? "").trim().slice(0, 5_000),
    normalizeCover(input.cover),
    JSON.stringify(normalizePostTags(input.tags ?? [])),
    input.featured ? 1 : 0,
    ts,
    ts,
  );
  return getGithubRepositoryByFullName(input.fullName)!;
}

export type GithubCustomInput = {
  custom_title?: string;
  custom_description?: string;
  cover?: string | null;
  tags?: string[];
  featured?: boolean;
};

/** 只更新手工字段与 updated_at，绝不触碰同步字段。 */
export function updateGithubRepositoryCustom(id: number, data: GithubCustomInput): GithubRepository | undefined {
  const current = getGithubRepository(id);
  if (!current) return undefined;
  db.prepare(`
    UPDATE github_repositories
    SET custom_title = ?, custom_description = ?, cover = ?, tags = ?, featured = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.custom_title === undefined ? current.custom_title : String(data.custom_title).trim().slice(0, 240),
    data.custom_description === undefined ? current.custom_description : String(data.custom_description).trim().slice(0, 5_000),
    data.cover === undefined ? current.cover : normalizeCover(data.cover),
    data.tags === undefined ? current.tags : JSON.stringify(normalizePostTags(data.tags)),
    data.featured === undefined ? current.featured : data.featured ? 1 : 0,
    now(),
    id,
  );
  return getGithubRepository(id);
}

/** 同步成功：覆盖自动字段并置 success；手工字段完全保留。 */
export function applyGithubSyncResult(id: number, metadata: GithubRepositoryMetadata): GithubRepository | undefined {
  const ts = now();
  db.prepare(`
    UPDATE github_repositories
    SET description = ?, homepage = ?, primary_language = ?, topics = ?, stars = ?, forks = ?, license = ?,
        default_branch = ?, archived = ?, visibility = ?, github_created_at = ?, github_updated_at = ?, pushed_at = ?,
        sync_status = 'success', sync_error = '', synced_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    metadata.description,
    metadata.homepage,
    metadata.primary_language,
    JSON.stringify(normalizeTopics(metadata.topics)),
    metadata.stars,
    metadata.forks,
    metadata.license,
    metadata.default_branch,
    metadata.archived,
    metadata.visibility,
    metadata.github_created_at,
    metadata.github_updated_at,
    metadata.pushed_at,
    ts,
    ts,
    id,
  );
  return getGithubRepository(id);
}

/** 同步失败：只记录状态与可读原因，保留上一次成功的自动字段，便于前台降级展示。 */
export function markGithubSyncError(id: number, message: string): GithubRepository | undefined {
  db.prepare("UPDATE github_repositories SET sync_status = 'error', sync_error = ?, updated_at = ? WHERE id = ?")
    .run(String(message ?? "").slice(0, 500), now(), id);
  return getGithubRepository(id);
}

export function getGithubRepository(id: number): GithubRepository | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare("SELECT * FROM github_repositories WHERE id = ?").get(id) as GithubRepository | undefined;
}

export function getGithubRepositoryByFullName(fullName: string): GithubRepository | undefined {
  const value = String(fullName ?? "").trim();
  if (!value) return undefined;
  return db.prepare("SELECT * FROM github_repositories WHERE full_name = ?").get(value) as GithubRepository | undefined;
}

export function deleteGithubRepository(id: number): void {
  const transaction = db.transaction(() => {
    // work 关联由外键 ON DELETE CASCADE 清理；这里额外断开引用关联。
    db.prepare("DELETE FROM reference_relations WHERE target_type = 'github_repository' AND target_id = ?").run(id);
    db.prepare("DELETE FROM github_repositories WHERE id = ?").run(id);
  });
  transaction();
}

export type GithubRepositoryListOptions = { limit?: number; offset?: number; featuredOnly?: boolean };

export function listGithubRepositories(options: GithubRepositoryListOptions = {}): GithubRepository[] {
  const { limit, offset, featuredOnly } = options;
  const where = featuredOnly ? "WHERE featured = 1" : "";
  let sql = `SELECT * FROM github_repositories ${where} ORDER BY featured DESC, registered_at DESC, id DESC`;
  const params: number[] = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as GithubRepository[];
}

export function countGithubRepositories(): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM github_repositories").get() as { c: number }).c);
}

export function getGithubRepositoriesByIds(ids: number[]): Map<number, GithubRepository> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, GithubRepository>();
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM github_repositories WHERE id IN (${placeholders})`).all(...unique) as GithubRepository[];
  for (const row of rows) map.set(row.id, row);
  return map;
}
