"use server";

import { requireAdmin } from "@/lib/auth";
import {
  deleteGithubRepositoryEntry,
  registerGithubRepositoryEntry,
  syncAllGithubRepositoryMetadata,
  syncGithubRepositoryMetadata,
  updateGithubRepositoryEntry,
  type GithubCustomFormInput,
} from "@/lib/admin/github-repositories";
import type { ActionResult } from "@/lib/actions/posts";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/github-repositories。 */

export async function registerGithubRepositoryAction(input: string, custom: GithubCustomFormInput = {}): Promise<ActionResult> {
  await requireAdmin();
  return registerGithubRepositoryEntry(input, custom);
}

export async function updateGithubRepositoryAction(id: number, custom: GithubCustomFormInput): Promise<ActionResult> {
  await requireAdmin();
  return updateGithubRepositoryEntry(id, custom);
}

export async function deleteGithubRepositoryAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteGithubRepositoryEntry(id);
}

export async function syncGithubRepositoryAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return syncGithubRepositoryMetadata(id);
}

export async function syncAllGithubRepositoriesAction(): Promise<ActionResult> {
  await requireAdmin();
  return syncAllGithubRepositoryMetadata();
}
