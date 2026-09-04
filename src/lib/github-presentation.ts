// GitHub 仓库展示优先级的纯逻辑：自定义字段优先于自动同步字段。
// 仅以 import type 引入实体形状，避免把 better-sqlite3 拖进浏览器包。
import type { GithubRepository } from "@/lib/db";

export function githubDisplayTitle(repository: Pick<GithubRepository, "custom_title" | "name">): string {
  return repository.custom_title.trim() || repository.name;
}

export function githubDisplayDescription(repository: Pick<GithubRepository, "custom_description" | "description">): string {
  return repository.custom_description.trim() || repository.description;
}

export function parseGithubTopics(repository: Pick<GithubRepository, "topics">): string[] {
  try {
    const value = JSON.parse(repository.topics) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseGithubTags(repository: Pick<GithubRepository, "tags">): string[] {
  try {
    const value = JSON.parse(repository.tags) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
