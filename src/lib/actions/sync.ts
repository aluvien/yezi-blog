"use server";

import { requireAdmin } from "@/lib/auth";
import {
  getGithubDeployStatus,
  getGithubVersionStatus,
  scheduleGithubRestart,
  syncLatestGithub,
} from "@/lib/admin/deploy";

export type SyncGithubActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type ScheduleGithubRestartActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type GithubDeployStatus = {
  status: "unknown" | "queued" | "building" | "switching" | "checking" | "rolling_back" | "success" | "failed";
  updatedAt?: string;
  error?: string;
};

export type GithubVersionStatus = {
  status: "up-to-date" | "outdated" | "dirty" | "unavailable";
  localCommit?: string;
  remoteCommit?: string;
  error?: string;
};

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/deploy。 */

export async function syncLatestGithubAction(): Promise<SyncGithubActionResult> {
  await requireAdmin();
  return syncLatestGithub();
}

export async function scheduleGithubRestartAction(): Promise<ScheduleGithubRestartActionResult> {
  await requireAdmin();
  return scheduleGithubRestart();
}

export async function getGithubDeployStatusAction(): Promise<GithubDeployStatus> {
  await requireAdmin();
  return getGithubDeployStatus();
}

export async function getGithubVersionStatusAction(options?: { bypassCache?: boolean }): Promise<GithubVersionStatus> {
  await requireAdmin();
  return getGithubVersionStatus(options);
}
