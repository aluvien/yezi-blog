import fs from "node:fs";

/**
 * A deployment worker creates this private file before it starts a candidate
 * against the live database.  The candidate may run its transactional schema
 * migrations, but must not accept any subsequent application writes until its
 * read-only health checks have succeeded.
 *
 * This deliberately uses a file instead of shared process state: Next Proxy
 * and route handlers are separate bundles, so globals are not a safe contract.
 */
export function isDeploymentWriteHoldActive(environment: NodeJS.ProcessEnv = process.env): boolean {
  const guardPath = environment.BLOG_DEPLOY_WRITE_GUARD_FILE?.trim();
  if (environment.BLOG_DEPLOY_WRITE_HOLD !== "true" || !guardPath) return false;
  return fs.existsSync(guardPath);
}
