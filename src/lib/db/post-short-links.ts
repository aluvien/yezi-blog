import crypto from "node:crypto";
import { db, now } from "./core";
import type { Post, PostShortLink } from "./types";

const SHORT_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{8}$/;

function randomShortCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (const byte of bytes) code += SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length];
  return code;
}

function hasAllCharacterClasses(code: string): boolean {
  return /[A-Z]/.test(code) && /[a-z]/.test(code) && /[0-9]/.test(code);
}

/** 生成满足“大小写字母 + 数字”混合要求的八位短码。 */
export function generatePostShortCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = randomShortCode();
    if (hasAllCharacterClasses(code)) return code;
  }
  // 随机连续失败的概率极低；固定字符只作为不可达的安全兜底。
  return "aA1bB2cC";
}

export function getPostShortLink(postId: number): PostShortLink | undefined {
  return db.prepare("SELECT code, post_id, created_at FROM post_short_links WHERE post_id = ?").get(postId) as PostShortLink | undefined;
}

/** 为文章惰性创建短码；重复调用始终返回同一条映射。 */
export function getOrCreatePostShortLink(postId: number): PostShortLink {
  const existing = getPostShortLink(postId);
  if (existing) return existing;

  const insert = db.prepare("INSERT INTO post_short_links (code, post_id, created_at) VALUES (?, ?, ?)");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generatePostShortCode();
    try {
      insert.run(code, postId, now());
      return getPostShortLink(postId)!;
    } catch (error) {
      // 仅在随机短码碰撞时重试；文章 id 唯一约束冲突应交给调用方处理。
      if (!(error instanceof Error) || !/UNIQUE constraint failed: post_short_links\.(?:code|post_id)/.test(error.message)) throw error;
      const concurrent = getPostShortLink(postId);
      if (concurrent) return concurrent;
    }
  }
  throw new Error("无法生成文章短链接");
}

export function getPublishedPostByShortCode(code: string): Post | undefined {
  if (!SHORT_CODE_PATTERN.test(code)) return undefined;
  return db.prepare(`
    SELECT posts.*
    FROM post_short_links
    INNER JOIN posts ON posts.id = post_short_links.post_id
    WHERE post_short_links.code = ? AND posts.status = 'published'
  `).get(code) as Post | undefined;
}
