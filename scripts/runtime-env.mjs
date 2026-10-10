import fs from "node:fs";

const MODEL_KEYS = new Set(["LLM_API_KEY", "OPENAI_API_KEY", "LLM_API_URL", "LLM_MODEL"]);
const CREDENTIAL_KEYS = new Set(["LLM_API_KEY", "OPENAI_API_KEY"]);

/** 模型配置以优先级最高的环境文件为准，避免 PM2 保存的旧值遮住新配置。
 * 端口、数据目录和部署控制变量仍保留原有的进程环境优先级。 */
export function loadRuntimeEnvFiles(files, env = process.env) {
  const loadedModelKeys = new Set();
  let credentialsSelected = false;
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    const entries = [];
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      const value = rawValue.trim();
      entries.push([key,
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value,
      ]);
    }
    const ownsCredentials = !credentialsSelected && entries.some(([key]) => CREDENTIAL_KEYS.has(key));
    if (ownsCredentials) {
      credentialsSelected = true;
      // 密钥别名属于同一组：文件只配置 OPENAI_API_KEY 时，也不能继续优先用旧 LLM_API_KEY。
      for (const key of CREDENTIAL_KEYS) delete env[key];
    }
    for (const [key, value] of entries) {
      if (CREDENTIAL_KEYS.has(key) && !ownsCredentials) continue;
      if (MODEL_KEYS.has(key)) {
        if (loadedModelKeys.has(key)) continue;
        loadedModelKeys.add(key);
      } else if (env[key] !== undefined) continue;
      env[key] = value;
    }
  }
  return env;
}
