import fs from "node:fs";
import path from "node:path";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export function readDeployedBuildCommit(root: string | undefined): string | null {
  if (!root) return null;

  try {
    const value = fs.readFileSync(path.join(root, "data", "deploy-commit"), "utf8").trim();
    return COMMIT_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Read the active release commit from durable state instead of relying solely
 * on process.env. Next standalone can replace non-public environment entries
 * while loading its generated server, whereas BLOG_ROOT remains stable.
 */
export function deployedBuildCommit(): string {
  const durableCommit = readDeployedBuildCommit(process.env.BLOG_ROOT?.trim());
  if (durableCommit) return durableCommit;
  return process.env.DEPLOY_BUILD_COMMIT?.trim() || "development";
}
