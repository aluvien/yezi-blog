import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRuntimeEnvFiles } from "../scripts/runtime-env.mjs";

function fixture(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-runtime-env-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return contents.map((content, index) => {
    const file = path.join(root, `env-${index}`);
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
  });
}

test("updated model file overrides stale PM2 values while runtime controls stay intact", t => {
  const files = fixture(t, ['LLM_API_KEY="new-key"\nLLM_API_URL=https://new.example/v1\nLLM_MODEL=new-model\nPORT=3000\nBLOG_ROOT=/file/data\nBLOG_DEPLOY_WRITE_HOLD=false']);
  const env = { LLM_API_KEY: "old-key", OPENAI_API_KEY: "old-alias", LLM_API_URL: "https://old.example/v1", LLM_MODEL: "old-model", PORT: "3030", BLOG_ROOT: "/runtime/data", BLOG_DEPLOY_WRITE_HOLD: "true" };
  loadRuntimeEnvFiles(files, env);
  assert.deepEqual(env, { LLM_API_KEY: "new-key", LLM_API_URL: "https://new.example/v1", LLM_MODEL: "new-model", PORT: "3030", BLOG_ROOT: "/runtime/data", BLOG_DEPLOY_WRITE_HOLD: "true" });
});

test("external model configuration wins over local and fallback environment files", t => {
  const files = fixture(t, ["LLM_API_KEY=external-key\nLLM_MODEL=external-model", "LLM_API_KEY=local-key\nOPENAI_API_KEY=local-alias\nLLM_API_URL=https://local.example/v1", "LLM_MODEL=fallback-model\nOTHER=fallback"]);
  const env = { LLM_API_KEY: "pm2-key", LLM_MODEL: "pm2-model", LLM_API_URL: "https://pm2.example/v1" };
  loadRuntimeEnvFiles(files, env);
  assert.deepEqual(env, { LLM_API_KEY: "external-key", LLM_MODEL: "external-model", LLM_API_URL: "https://local.example/v1", OTHER: "fallback" });
});

test("OPENAI_API_KEY in the selected file replaces a stale preferred LLM_API_KEY", t => {
  const files = fixture(t, ["OPENAI_API_KEY='new-openai-key'\nLLM_MODEL=new-model"]);
  const env = { LLM_API_KEY: "stale-preferred-key", OPENAI_API_KEY: "stale-openai-key" };
  loadRuntimeEnvFiles(files, env);
  assert.deepEqual(env, { OPENAI_API_KEY: "new-openai-key", LLM_MODEL: "new-model" });
});

test("environment-only model credentials remain available when files omit credentials", t => {
  const files = fixture(t, ["LLM_MODEL=file-model\nPORT=3000\n# ignored\nnot an assignment"]);
  const env = { LLM_API_KEY: "injected-key", PORT: "3030" };
  loadRuntimeEnvFiles(["", path.join(path.dirname(files[0]), "missing"), ...files], env);
  assert.deepEqual(env, { LLM_API_KEY: "injected-key", PORT: "3030", LLM_MODEL: "file-model" });
});

test("explicitly clearing file credentials prevents fallback to stale PM2 aliases", t => {
  const files = fixture(t, ['LLM_API_KEY=""', "OPENAI_API_KEY=old-fallback"]);
  const env = { LLM_API_KEY: "old-key", OPENAI_API_KEY: "old-alias" };
  loadRuntimeEnvFiles(files, env);
  assert.deepEqual(env, { LLM_API_KEY: "" });
});
