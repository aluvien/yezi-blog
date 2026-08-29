import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDeployedBuildCommit } from "../src/lib/deploy-build.ts";

test("readDeployedBuildCommit reads a valid active release marker", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "data"));

  const commit = "a641192e5b01e236c146d0585a5141cc1a55b67d";
  fs.writeFileSync(path.join(root, "data", "deploy-commit"), `${commit}\n`);

  assert.equal(readDeployedBuildCommit(root), commit);
});

test("readDeployedBuildCommit returns null for a missing or invalid marker", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(readDeployedBuildCommit(root), null);
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "data", "deploy-commit"), "not-a-commit\n");
  assert.equal(readDeployedBuildCommit(root), null);
});
