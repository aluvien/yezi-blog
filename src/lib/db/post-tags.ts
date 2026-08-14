// post_tags 关系表维护。posts.tags 仍保留为兼容既有 API 和数据库数据的 JSON 字段；
// 此表只承担可索引的查询职责，所有写入必须在所属文章事务中同步。
import { db } from "./core";
import { normalizePostTags } from "@/lib/post-tags";

export function normalizeTagKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function replacePostTagRelations(postId: number, tags: readonly string[]): void {
  const normalizedTags = normalizePostTags([...tags]);
  const clear = db.prepare("DELETE FROM post_tags WHERE post_id = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag, normalized_tag) VALUES (?, ?, ?)");
  clear.run(postId);
  for (const tag of normalizedTags) {
    insert.run(postId, tag, normalizeTagKey(tag));
  }
}
