// 文章引用、独立引用库、私有阅读归档与后台任务 DAO。
import { db, now } from "./core";
import { normalizeArticleReferenceSnapshot, type ArticleReferenceSnapshot } from "@/lib/article-reference";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";
import type {
  ArticleReference,
  ArticleReferenceWithPost,
  ArticleReferenceArchive,
  ArticleReferenceArchiveJobRecord,
  ReferenceLibraryItem,
} from "./types";

/** 将正文里的引用快照同步为本地缓存，文章访问时不再请求第三方网页。 */
export function syncArticleReferences(postId: number, snapshots: ArticleReferenceSnapshot[]): void {
  const unique = new Map<string, ArticleReferenceSnapshot>();
  for (const snapshot of snapshots) {
    const key = snapshot.canonicalUrl || snapshot.url;
    if (key) unique.set(key, snapshot);
  }
  const transaction = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO article_references
        (post_id, url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id, canonical_url) DO UPDATE SET
        url = excluded.url,
        title = excluded.title,
        source_name = excluded.source_name,
        author = excluded.author,
        published_at = excluded.published_at,
        cover = excluded.cover,
        description = excluded.description,
        summary = excluded.summary,
        key_points = excluded.key_points,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const snapshot of unique.values()) {
      upsertReferenceLibrarySnapshot(snapshot, {}, timestamp);
      upsert.run(
        postId,
        snapshot.url,
        snapshot.canonicalUrl || snapshot.url,
        snapshot.title,
        snapshot.source,
        snapshot.author,
        snapshot.publishedAt,
        snapshot.cover,
        snapshot.description,
        snapshot.summary,
        JSON.stringify(snapshot.keyPoints),
        timestamp,
        timestamp,
      );
    }
    if (unique.size === 0) {
      db.prepare("DELETE FROM article_references WHERE post_id = ?").run(postId);
      return;
    }
    const placeholders = [...unique.keys()].map(() => "?").join(",");
    db.prepare(`DELETE FROM article_references WHERE post_id = ? AND canonical_url NOT IN (${placeholders})`).run(postId, ...unique.keys());
  });
  transaction();
}

export type ReferenceLibraryMetadata = {
  category?: string;
  tags?: string | string[];
};

function normalizeReferenceTags(input: string | string[] | null | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of normalizePostTags(input)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** 保存或更新独立引用库；同一 canonical URL 只保留一条资料。 */
export function upsertReferenceLibrarySnapshot(input: ArticleReferenceSnapshot, metadata: ReferenceLibraryMetadata = {}, timestamp = now()): ReferenceLibraryItem {
  const category = metadata.category ?? "";
  const snapshot = normalizeArticleReferenceSnapshot(input);
  const canonicalUrl = snapshot.canonicalUrl || snapshot.url;
  if (!canonicalUrl) throw new Error("引用网址无效");
  const normalizedTags = JSON.stringify(normalizeReferenceTags(metadata.tags));
  const normalizedCategory = String(category ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  db.prepare(`
    INSERT INTO reference_library
      (url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, category, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      url = excluded.url,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE reference_library.title END,
      source_name = CASE WHEN excluded.source_name != '' THEN excluded.source_name ELSE reference_library.source_name END,
      author = CASE WHEN excluded.author != '' THEN excluded.author ELSE reference_library.author END,
      published_at = CASE WHEN excluded.published_at != '' THEN excluded.published_at ELSE reference_library.published_at END,
      cover = CASE WHEN excluded.cover != '' THEN excluded.cover ELSE reference_library.cover END,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE reference_library.description END,
      summary = CASE WHEN excluded.summary != '' THEN excluded.summary ELSE reference_library.summary END,
      key_points = CASE WHEN excluded.key_points != '[]' THEN excluded.key_points ELSE reference_library.key_points END,
      category = CASE WHEN excluded.category != '' THEN excluded.category ELSE reference_library.category END,
      tags = CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE reference_library.tags END,
      updated_at = excluded.updated_at
  `).run(
    snapshot.url,
    canonicalUrl,
    snapshot.title,
    snapshot.source,
    snapshot.author,
    snapshot.publishedAt,
    snapshot.cover,
    snapshot.description,
    snapshot.summary,
    JSON.stringify(snapshot.keyPoints),
    normalizedCategory,
    normalizedTags,
    timestamp,
    timestamp,
  );
  return getReferenceLibraryItemByCanonicalUrl(canonicalUrl)!;
}

export function getReferenceLibraryItem(id: number): ReferenceLibraryItem | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare(`
    SELECT rl.*, ara.captured_at AS archive_captured_at, ara.updated_at AS archive_updated_at, ara.cache_report AS archive_cache_report,
      COUNT(ar.id) AS linked_post_count,
      GROUP_CONCAT(DISTINCT p.title) AS linked_post_titles
    FROM reference_library rl
    LEFT JOIN article_reference_archives ara ON ara.canonical_url = rl.canonical_url OR ara.url = rl.url
    LEFT JOIN article_references ar ON ar.canonical_url = rl.canonical_url OR ar.url = rl.url
    LEFT JOIN posts p ON p.id = ar.post_id
    WHERE rl.id = ?
    GROUP BY rl.id
  `).get(id) as ReferenceLibraryItem | undefined;
}

function getReferenceLibraryItemByCanonicalUrl(canonicalUrl: string): ReferenceLibraryItem | undefined {
  return db.prepare(`
    SELECT rl.*, ara.captured_at AS archive_captured_at, ara.updated_at AS archive_updated_at, ara.cache_report AS archive_cache_report,
      COUNT(ar.id) AS linked_post_count,
      GROUP_CONCAT(DISTINCT p.title) AS linked_post_titles
    FROM reference_library rl
    LEFT JOIN article_reference_archives ara ON ara.canonical_url = rl.canonical_url OR ara.url = rl.url
    LEFT JOIN article_references ar ON ar.canonical_url = rl.canonical_url OR ar.url = rl.url
    LEFT JOIN posts p ON p.id = ar.post_id
    WHERE rl.canonical_url = ? OR rl.url = ?
    GROUP BY rl.id
  `).get(canonicalUrl, canonicalUrl) as ReferenceLibraryItem | undefined;
}

export type ReferenceLibraryQuery = {
  keyword?: string;
  category?: string;
  limit?: number;
  offset?: number;
};

function referenceLibraryFilters(options: Pick<ReferenceLibraryQuery, "keyword" | "category">): { where: string; parameters: string[] } {
  const keyword = String(options.keyword ?? "").trim().slice(0, 120);
  const category = String(options.category ?? "").trim().slice(0, 80);
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (category) {
    if (category === "__uncategorized") {
      conditions.push("trim(rl.category) = ''");
    } else {
      conditions.push("rl.category = ?");
      parameters.push(category);
    }
  }
  if (keyword) {
    conditions.push(`(
      instr(lower(rl.title), lower(?)) > 0
      OR instr(lower(rl.source_name), lower(?)) > 0
      OR instr(lower(rl.author), lower(?)) > 0
      OR instr(lower(rl.url), lower(?)) > 0
      OR instr(lower(rl.description), lower(?)) > 0
      OR instr(lower(rl.summary), lower(?)) > 0
      OR instr(lower(rl.key_points), lower(?)) > 0
      OR instr(lower(rl.category), lower(?)) > 0
      OR instr(lower(rl.tags), lower(?)) > 0
    )`);
    parameters.push(...Array.from({ length: 9 }, () => keyword));
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, parameters };
}

export function listReferenceLibrary(options: ReferenceLibraryQuery = {}): ReferenceLibraryItem[] {
  const { where, parameters } = referenceLibraryFilters(options);
  const { limit, offset } = options;
  let pagination = "";
  const paginationParameters: number[] = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    pagination = " LIMIT ?";
    paginationParameters.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      pagination += " OFFSET ?";
      paginationParameters.push(offset as number);
    }
  }
  return db.prepare(`
    SELECT rl.*, ara.captured_at AS archive_captured_at, ara.updated_at AS archive_updated_at, ara.cache_report AS archive_cache_report,
      COUNT(ar.id) AS linked_post_count,
      GROUP_CONCAT(DISTINCT p.title) AS linked_post_titles
    FROM reference_library rl
    LEFT JOIN article_reference_archives ara ON ara.canonical_url = rl.canonical_url OR ara.url = rl.url
    LEFT JOIN article_references ar ON ar.canonical_url = rl.canonical_url OR ar.url = rl.url
    LEFT JOIN posts p ON p.id = ar.post_id
    ${where}
    GROUP BY rl.id
    ORDER BY rl.updated_at DESC, rl.id DESC${pagination}
  `).all(...parameters, ...paginationParameters) as ReferenceLibraryItem[];
}

export function countReferenceLibrary(options: Pick<ReferenceLibraryQuery, "keyword" | "category"> = {}): number {
  const { where, parameters } = referenceLibraryFilters(options);
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM reference_library rl ${where}`).get(...parameters) as { count: number }).count);
}

export function listReferenceLibraryCategories(): Array<{ category: string; count: number }> {
  return db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM reference_library
    WHERE trim(category) != ''
    GROUP BY category COLLATE NOCASE
    ORDER BY category COLLATE NOCASE ASC
  `).all() as Array<{ category: string; count: number }>;
}

/** 聚合引用库已有标签，供后台编辑时复用；不混入文章标签导航。 */
export function listReferenceLibraryTags(): Array<{ tag: string; count: number }> {
  const tags = new Map<string, { tag: string; count: number }>();
  const rows = db.prepare("SELECT tags FROM reference_library").all() as Array<{ tags: string }>;
  for (const row of rows) {
    for (const tag of parsePostTags(row.tags)) {
      const key = tag.toLocaleLowerCase();
      const current = tags.get(key);
      if (current) current.count += 1;
      else tags.set(key, { tag, count: 1 });
    }
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/** 更新独立引用的分类和标签，不影响文章正文中的引用快照。 */
export function updateReferenceLibraryMetadata(id: number, category: string, tags: string | string[] = []): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const normalizedCategory = String(category ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const normalizedTags = JSON.stringify(normalizeReferenceTags(tags));
  return db.prepare("UPDATE reference_library SET category = ?, tags = ?, updated_at = ? WHERE id = ?").run(normalizedCategory, normalizedTags, now(), id).changes > 0;
}

export function updateReferenceLibraryCategory(id: number, category: string): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const normalizedCategory = String(category ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return db.prepare("UPDATE reference_library SET category = ?, updated_at = ? WHERE id = ?").run(normalizedCategory, now(), id).changes > 0;
}

/**
 * 从独立引用资料库移除一条记录。文章正文中的快照和关联关系保留，
 * 避免管理页清理资料库时意外改写已经发布的文章。
 */
export function deleteReferenceLibrary(id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  return db.prepare("DELETE FROM reference_library WHERE id = ?").run(id).changes > 0;
}

/** 批量移除引用资料库记录；只处理正整数 ID，重复 ID 会自动去重。 */
export function deleteReferenceLibraryMany(ids: number[]): number {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (uniqueIds.length === 0) return 0;
  const placeholders = uniqueIds.map(() => "?").join(",");
  return db.prepare(`DELETE FROM reference_library WHERE id IN (${placeholders})`).run(...uniqueIds).changes;
}

export function listArticleReferencesForPost(postId: number): ArticleReference[] {
  return db
    .prepare("SELECT * FROM article_references WHERE post_id = ? ORDER BY id ASC")
    .all(postId) as ArticleReference[];
}

export function getArticleReference(id: number): ArticleReference | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare("SELECT * FROM article_references WHERE id = ?").get(id) as ArticleReference | undefined;
}

export function getArticleReferenceArchive(canonicalUrl: string): ArticleReferenceArchive | undefined {
  const value = canonicalUrl.trim();
  if (!value) return undefined;
  return db
    .prepare("SELECT * FROM article_reference_archives WHERE canonical_url = ? OR url = ? ORDER BY updated_at DESC LIMIT 1")
    .get(value, value) as ArticleReferenceArchive | undefined;
}

export function upsertArticleReferenceArchive(data: Omit<ArticleReferenceArchive, "captured_at" | "updated_at">): ArticleReferenceArchive {
  const timestamp = now();
  db.prepare(`
    INSERT INTO article_reference_archives
      (canonical_url, url, title, source_name, author, published_at, reader_html, reader_markdown, reader_text, summary, key_points, ai_cleaned_at, raw_path, content_hash, cache_report, captured_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      source_name = excluded.source_name,
      author = excluded.author,
      published_at = excluded.published_at,
      reader_html = excluded.reader_html,
      reader_markdown = excluded.reader_markdown,
      reader_text = excluded.reader_text,
      summary = excluded.summary,
      key_points = excluded.key_points,
      ai_cleaned_at = excluded.ai_cleaned_at,
      raw_path = excluded.raw_path,
      content_hash = excluded.content_hash,
      cache_report = excluded.cache_report,
      updated_at = excluded.updated_at
  `).run(
    data.canonical_url,
    data.url,
    data.title,
    data.source_name,
    data.author,
    data.published_at,
    data.reader_html,
    data.reader_markdown,
    data.reader_text,
    data.summary,
    data.key_points,
    data.ai_cleaned_at,
    data.raw_path,
    data.content_hash,
    data.cache_report,
    timestamp,
    timestamp,
  );
  return getArticleReferenceArchive(data.canonical_url)!;
}

// ---------- article reference archive jobs ----------

export function getArticleReferenceArchiveJobRecord(id: string): ArticleReferenceArchiveJobRecord | undefined {
  return db.prepare("SELECT * FROM article_reference_archive_jobs WHERE id = ?").get(id) as ArticleReferenceArchiveJobRecord | undefined;
}

export function findActiveArticleReferenceArchiveJob(url: string): ArticleReferenceArchiveJobRecord | undefined {
  return db
    .prepare("SELECT * FROM article_reference_archive_jobs WHERE url = ? AND state IN ('queued', 'running') ORDER BY created_at ASC LIMIT 1")
    .get(url) as ArticleReferenceArchiveJobRecord | undefined;
}

export function countActiveArticleReferenceArchiveJobs(): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS count FROM article_reference_archive_jobs WHERE state IN ('queued', 'running')").get() as { count: number }).count,
  );
}

export function createArticleReferenceArchiveJobRecord(id: string, url: string): ArticleReferenceArchiveJobRecord {
  const timestamp = now();
  db.prepare(`
    INSERT INTO article_reference_archive_jobs (id, url, state, created_at, updated_at, result_json, error)
    VALUES (?, ?, 'queued', ?, ?, '', '')
  `).run(id, url, timestamp, timestamp);
  return getArticleReferenceArchiveJobRecord(id)!;
}

export function claimArticleReferenceArchiveJob(id: string): boolean {
  return db
    .prepare("UPDATE article_reference_archive_jobs SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'")
    .run(now(), id).changes > 0;
}

export function completeArticleReferenceArchiveJob(id: string, result: unknown): void {
  db.prepare(`
    UPDATE article_reference_archive_jobs
    SET state = 'completed', updated_at = ?, result_json = ?, error = ''
    WHERE id = ?
  `).run(now(), JSON.stringify(result), id);
}

export function failArticleReferenceArchiveJob(id: string, error: string): void {
  db.prepare(`
    UPDATE article_reference_archive_jobs
    SET state = 'failed', updated_at = ?, error = ?
    WHERE id = ?
  `).run(now(), error.slice(0, 2_000), id);
}

export function listQueuedArticleReferenceArchiveJobs(limit = 3): ArticleReferenceArchiveJobRecord[] {
  const safeLimit = Math.max(0, Math.min(20, Math.trunc(limit)));
  if (safeLimit === 0) return [];
  return db
    .prepare("SELECT * FROM article_reference_archive_jobs WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?")
    .all(safeLimit) as ArticleReferenceArchiveJobRecord[];
}

export function recoverStaleArticleReferenceArchiveJobs(staleBefore: string): number {
  return db
    .prepare("UPDATE article_reference_archive_jobs SET state = 'queued', updated_at = ? WHERE state = 'running' AND updated_at < ?")
    .run(now(), staleBefore).changes;
}

export function pruneArticleReferenceArchiveJobs(maxRetained = 30, retentionMs = 24 * 60 * 60 * 1000): void {
  const retentionCutoff = new Date(Date.now() - Math.max(0, retentionMs)).toISOString();
  db.prepare("DELETE FROM article_reference_archive_jobs WHERE state IN ('completed', 'failed') AND updated_at < ?").run(retentionCutoff);
  const safeMax = Math.max(0, Math.trunc(maxRetained));
  const staleRows = db
    .prepare(`
      SELECT id FROM article_reference_archive_jobs
      WHERE state IN ('completed', 'failed')
      ORDER BY updated_at DESC
      LIMIT -1 OFFSET ?
    `)
    .all(safeMax) as Array<{ id: string }>;
  const remove = db.prepare("DELETE FROM article_reference_archive_jobs WHERE id = ? AND state IN ('completed', 'failed')");
  const transaction = db.transaction((ids: string[]) => {
    for (const id of ids) remove.run(id);
  });
  transaction(staleRows.map((row) => row.id));
}

/** 同一篇站外文章可能被多个本地文章引用；AI 摘要应保持一致更新。 */
export function updateArticleReferenceSummary(canonicalUrl: string, summary: string, keyPoints: string[]): void {
  const normalized = canonicalUrl.trim();
  if (!normalized) return;
  db.prepare(`
    UPDATE article_references
    SET summary = ?, key_points = ?, updated_at = ?
    WHERE canonical_url = ? OR url = ?
  `).run(summary, JSON.stringify(keyPoints), now(), normalized, normalized);
  db.prepare(`
    UPDATE reference_library
    SET summary = ?, key_points = ?, updated_at = ?
    WHERE canonical_url = ? OR url = ?
  `).run(summary, JSON.stringify(keyPoints), now(), normalized, normalized);
}

export function articleReferenceRowToSnapshot(reference: ArticleReference): ArticleReferenceSnapshot {
  let keyPoints: string[] = [];
  try {
    const parsed = JSON.parse(reference.key_points) as unknown;
    if (Array.isArray(parsed)) keyPoints = parsed.map((item) => String(item ?? "")).filter(Boolean).slice(0, 6);
  } catch {
    // 旧数据的摘要字段异常时，仍然保留其余引用信息。
  }
  return normalizeArticleReferenceSnapshot({
    url: reference.url,
    canonicalUrl: reference.canonical_url,
    title: reference.title,
    source: reference.source_name,
    author: reference.author,
    publishedAt: reference.published_at,
    cover: reference.cover,
    description: reference.description,
    summary: reference.summary,
    keyPoints,
  });
}

export function listArticleReferenceSnapshotsForPost(postId: number): ArticleReferenceSnapshot[] {
  return listArticleReferencesForPost(postId).map(articleReferenceRowToSnapshot);
}

export function countArticleReferences(): number {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM reference_library").get() as { count: number }).count);
}

export function listArticleReferences(): ArticleReferenceWithPost[] {
  return db.prepare(`
    SELECT ar.*, p.title AS post_title, p.slug AS post_slug, p.status AS post_status,
      ara.captured_at AS archive_captured_at, ara.updated_at AS archive_updated_at
    FROM article_references ar
    INNER JOIN posts p ON p.id = ar.post_id
    LEFT JOIN article_reference_archives ara ON ara.canonical_url = ar.canonical_url OR ara.url = ar.url
    ORDER BY ar.updated_at DESC, ar.id DESC
  `).all() as ArticleReferenceWithPost[];
}

/**
 * 编辑器引用弹窗使用的历史引用：按最近更新时间倒序，并按 canonical_url 去重。
 * 默认只返回最近 5 条；搜索时由调用方传入更大的上限，匹配标题、来源、作者和网址等字段。
 */
export function listRecentArticleReferences(keyword = "", limit = 5): ArticleReference[] {
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
  const needle = keyword.trim().toLocaleLowerCase();
  const rows = db.prepare("SELECT * FROM reference_library ORDER BY updated_at DESC, id DESC").all() as Array<Omit<ArticleReference, "post_id">>;
  return rows
    .filter((row) => {
      if (!needle) return true;
      return [row.title, row.source_name, row.author, row.url, row.canonical_url, row.description, row.summary, row.key_points]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    })
    .slice(0, safeLimit)
    .map((row) => ({ ...row, post_id: 0 }));
}
