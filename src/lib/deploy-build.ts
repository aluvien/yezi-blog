import fs from "node:fs";
import path from "node:path";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * Read the active release commit from durable state instead of relying solely
 * on process.env. Next standalone can replace non-public environment entries
 * while loading its generated server, whereas BLOG_ROOT remains stable.
 */
export function deployedBuildCommit(): string {
  const root = process.env.BLOG_ROOT?.trim();
  if (root) {
    try {
      const value = fs.readFileSync(path.join(root, "data", "deploy-commit"), "utf8").trim();
      if (COMMIT_PATTERN.test(value)) return value;
    } catch {
      // A manually started development instance has no release marker.
    }
  }
  return process.env.DEPLOY_BUILD_COMMIT?.trim() || "development";
}
