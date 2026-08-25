// db.ts 作为 re-export 桶：保持所有调用方 `from "@/lib/db"` 的 import 不变。
// 具体 DAO 已按实体拆到 src/lib/db/ 子模块，职责见各文件；公共设施见 core.ts。
export { db } from "./db/core";
export * from "./db/types";
export * from "./db/posts";
export * from "./db/references";
export * from "./db/attachments";
export * from "./db/moments";
export * from "./db/works";
export * from "./db/comments";
export * from "./db/taxonomy";
export * from "./db/metrics";
export * from "./db/settings";
export * from "./db/session-auth";
export * from "./db/maintenance";
export * from "./db/search";
export * from "./db/feed";
export { normalizeTagKey, replacePostTagRelations } from "./db/post-tags";
export { FTS_SCHEMA_VERSION, ensureFtsIndexes, rebuildFtsIndexes } from "./db/fts";
export { LATEST_DB_SCHEMA_VERSION } from "./db/migrations";

export { normalizePostTags, parsePostTags } from "@/lib/post-tags";
export { parseMomentImages } from "@/lib/moments";
export { slugify } from "@/lib/slug";
