"use server";

import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
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
  const epoch = currentDataEpoch();
  await requireAdmin();
  const rejected = dataWriteRejection(epoch);
  if (rejected) return { ok: false, error: rejected };
  return registerGithubRepositoryEntry(input, custom);
}

export async function updateGithubRepositoryAction(id: number, custom: GithubCustomFormInput): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  const rejected = dataWriteRejection(epoch);
  if (rejected) return { ok: false, error: rejected };
  return updateGithubRepositoryEntry(id, custom);
}

export async function deleteGithubRepositoryAction(id: number): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  const rejected = dataWriteRejection(epoch);
  if (rejected) return { ok: false, error: rejected };
  return deleteGithubRepositoryEntry(id);
}

export async function syncGithubRepositoryAction(id: number): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  const rejected = dataWriteRejection(epoch);
  if (rejected) return { ok: false, error: rejected };
  return syncGithubRepositoryMetadata(id);
}

export async function syncAllGithubRepositoriesAction(): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  const rejected = dataWriteRejection(epoch);
  if (rejected) return { ok: false, error: rejected };
  return syncAllGithubRepositoryMetadata();
}
