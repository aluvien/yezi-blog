import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const e2eRoot = path.join(os.tmpdir(), "yezi-blog-playwright");
fs.rmSync(e2eRoot, { recursive: true, force: true });
fs.mkdirSync(e2eRoot, { recursive: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    // APIRequestContext is not a browser and therefore does not add Origin.
    // Keep native E2E writes on the same boundary as the browser admin UI.
    extraHTTPHeaders: {
      origin: "http://127.0.0.1:3100",
      "x-yezi-csrf": "1",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node_modules/.bin/next dev -p 3100",
    url: "http://127.0.0.1:3100",
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      ...process.env,
      ADMIN_PASSWORD: "e2e-test-password",
      BLOG_ROOT: e2eRoot,
      BLOG_DB_PATH: path.join(e2eRoot, "data", "blog.db"),
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      SESSION_COOKIE_SECURE: "false",
      TRUST_PROXY: "false",
    },
  },
});
