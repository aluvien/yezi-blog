// 数据实体类型集中定义，避免各 DAO 子模块互相 import。
// 所有子模块只依赖本文件 + core.ts + 纯工具模块。

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  cover: string | null;
  category: string;
  /** JSON 数组字符串，如 '["Next.js","设计"]' */
  tags: string;
  created_at: string;
  updated_at: string;
  status: "draft" | "published";
}

export interface ArticleReference {
  id: number;
  post_id: number;
  url: string;
  canonical_url: string;
  title: string;
  source_name: string;
  author: string;
  published_at: string;
  cover: string;
  description: string;
  summary: string;
  key_points: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleReferenceWithPost extends ArticleReference {
  post_title: string;
  post_slug: string;
  post_status: "draft" | "published";
  archive_captured_at: string | null;
  archive_updated_at: string | null;
}

/** 可独立保存、可选关联本地文章的站外引用。 */
export interface ReferenceLibraryItem {
  id: number;
  url: string;
  canonical_url: string;
  title: string;
  source_name: string;
  author: string;
  published_at: string;
  cover: string;
  description: string;
  summary: string;
  key_points: string;
  category: string;
  /** JSON 数组字符串，如 '["阅读","架构"]' */
  tags: string;
  created_at: string;
  updated_at: string;
  archive_captured_at: string | null;
  archive_updated_at: string | null;
  archive_cache_report: string | null;
  linked_post_count: number;
  linked_post_titles: string | null;
}

/**
 * 引用文章的私有阅读归档。正文和原始 HTML 都只供管理员后台使用，
 * 前台文章继续只使用元信息和 AI 摘要卡片。
 */
export interface ArticleReferenceArchive {
  canonical_url: string;
  url: string;
  title: string;
  source_name: string;
  author: string;
  published_at: string;
  reader_html: string;
  reader_markdown: string;
  reader_text: string;
  summary: string;
  key_points: string;
  ai_cleaned_at: string;
  raw_path: string;
  content_hash: string;
  cache_report: string;
  captured_at: string;
  updated_at: string;
}

export type ArticleReferenceArchiveJobState = "queued" | "running" | "completed" | "failed";

export interface ArticleReferenceArchiveJobRecord {
  id: string;
  url: string;
  state: ArticleReferenceArchiveJobState;
  created_at: string;
  updated_at: string;
  result_json: string;
  error: string;
}

export interface Moment {
  id: number;
  content: string;
  /** JSON 数组字符串，如 '["/uploads/202607/a.jpg"]' */
  images: string;
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: number;
  title: string;
  description: string;
  cover: string | null;
  link: string | null;
  sort_order: number;
  created_at: string;
}

export interface Comment {
  id: number;
  target_type: "post" | "moment";
  target_id: number;
  nickname: string;
  email: string | null;
  website: string | null;
  content: string;
  /** 不可逆 IP 摘要；字段名为兼容旧数据库保留。 */
  ip: string;
  /** 不可逆 IP 摘要；字段名为兼容旧数据库保留。 */
  ip_address: string;
  status: "pending" | "approved";
  created_at: string;
  admin_reply: string | null;
  replied_at: string | null;
}

export interface CommentWithTarget extends Comment {
  /** 文章标题或想法内容摘要，目标已删除时为 null */
  target_label: string | null;
  target_slug: string | null;
}

export interface Attachment {
  id: number;
  post_id: number | null;
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface AttachmentReference {
  type: "post" | "moment" | "setting";
  id: number;
  label: string;
  slug?: string;
  usage?: "content" | "cover" | "content+cover";
}

export interface AttachmentWithUsage extends Attachment {
  /** 引用此附件的文章、想法或站点设置（按正文、封面、图片及设置内容匹配） */
  references: AttachmentReference[];
  referenced: boolean;
  /** true 表示数据库有记录；false 表示仅在上传目录扫描到，尚未入库。 */
  tracked: boolean;
}

export interface Session {
  id: string;
  created_at: string;
  expires_at: number;
}

export interface LoginAttempt {
  ip: string;
  failed_count: number;
  first_failed_at: number;
  blocked_until: number;
}

export interface SiteSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface ContentMetrics {
  views: number;
  likes: number;
}

export type ContentTarget = "post" | "moment";
export type InteractionKind = "view" | "like";
