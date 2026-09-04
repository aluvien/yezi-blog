// 作品与 GitHub 仓库的多对多关联。一个作品可关联 0 个或多个仓库，
// 一个仓库也可关联到多个作品。works 表本身不加 github_repo_id 之类的单值列。
import { db, now } from "./core";

/** 用给定仓库集合替换某作品的全部关联；只接受真实存在的仓库 id，忽略非法值。 */
export function setWorkRepositories(workId: number, repositoryIds: number[]): void {
  if (!Number.isInteger(workId) || workId <= 0) return;
  const unique = [...new Set(repositoryIds.filter((id) => Number.isInteger(id) && id > 0))];
  const ts = now();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM work_github_repositories WHERE work_id = ?").run(workId);
    if (unique.length === 0) return;
    const placeholders = unique.map(() => "?").join(",");
    // 只保留确实存在的仓库，避免脏关联；一次批量校验。
    const existing = new Set(
      (db.prepare(`SELECT id FROM github_repositories WHERE id IN (${placeholders})`).all(...unique) as Array<{ id: number }>).map((row) => row.id),
    );
    const insert = db.prepare("INSERT OR IGNORE INTO work_github_repositories (work_id, repository_id, created_at) VALUES (?, ?, ?)");
    for (const id of unique) {
      if (existing.has(id)) insert.run(workId, id, ts);
    }
  });
  transaction();
}

export function listRepositoryIdsForWork(workId: number): number[] {
  if (!Number.isInteger(workId) || workId <= 0) return [];
  return (db.prepare("SELECT repository_id FROM work_github_repositories WHERE work_id = ? ORDER BY repository_id ASC").all(workId) as Array<{ repository_id: number }>).map((row) => row.repository_id);
}

/** 批量：一次查询取回多个作品的关联仓库，避免列表页 N+1。 */
export function listRepositoryIdsForWorks(workIds: number[]): Map<number, number[]> {
  const unique = [...new Set(workIds.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, number[]>();
  if (unique.length === 0) return map;
  for (const id of unique) map.set(id, []);
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(
    "SELECT work_id, repository_id FROM work_github_repositories WHERE work_id IN (?) ORDER BY work_id, repository_id".replace("IN (?)", `IN (${placeholders})`),
  ).all(...unique) as Array<{ work_id: number; repository_id: number }>;
  for (const row of rows) map.get(row.work_id)?.push(row.repository_id);
  return map;
}
