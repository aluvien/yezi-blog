import fs from "node:fs";
import path from "node:path";

export function deploymentCommandEnv(env = process.env, execPath = process.execPath) {
  const pm2Bin = env.DEPLOY_PM2_BIN?.trim();
  const directories = [
    path.dirname(execPath),
    ...(pm2Bin && path.isAbsolute(pm2Bin) ? [path.dirname(pm2Bin)] : []),
    ...(env.PATH || "").split(path.delimiter),
  ].filter(Boolean);
  return { ...env, PATH: [...new Set(directories)].join(path.delimiter) };
}

function nodeScript(file) {
  const handle = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(128);
    const size = fs.readSync(handle, header, 0, header.length, 0);
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(header.toString("utf8", 0, size).split(/\r?\n/)[0]);
  } finally {
    fs.closeSync(handle);
  }
}

export function resolvePm2Command({ env = process.env, execPath = process.execPath, cwd = process.cwd() } = {}) {
  const commandEnv = deploymentCommandEnv(env, execPath);
  const configured = env.DEPLOY_PM2_BIN?.trim();
  const nodeDirectory = path.dirname(execPath);
  const prefix = env.npm_config_prefix?.trim() || env.NPM_CONFIG_PREFIX?.trim();
  const candidates = configured ? [path.resolve(cwd, configured)] : [
    ...commandEnv.PATH.split(path.delimiter).filter(Boolean).map((directory) => path.resolve(cwd, directory, "pm2")),
    ...(prefix ? [path.join(prefix, "bin", "pm2"), path.join(prefix, "lib", "node_modules", "pm2", "bin", "pm2")] : []),
    path.join(nodeDirectory, "..", "lib", "node_modules", "pm2", "bin", "pm2"),
    path.join(cwd, "node_modules", "pm2", "bin", "pm2"),
  ];
  let unusableCandidate = false;
  for (const candidate of new Set(candidates)) {
    try {
      const bin = fs.realpathSync(candidate);
      if (!fs.statSync(bin).isFile()) {
        unusableCandidate = true;
        continue;
      }
      const useNode = nodeScript(bin);
      if (!useNode) fs.accessSync(bin, fs.constants.X_OK);
      return {
        bin,
        command: useNode ? execPath : bin,
        args: useNode ? [bin] : [],
        env: deploymentCommandEnv({ ...commandEnv, DEPLOY_PM2_BIN: bin }, execPath),
      };
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") unusableCandidate = true;
      continue;
    }
  }
  const error = new Error(configured
    ? `DEPLOY_PM2_BIN 指定的 PM2 命令不可用：${configured}`
    : "找不到 PM2 命令；请将 DEPLOY_PM2_BIN 设置为服务器上 pm2 命令的绝对路径，并重启网站进程加载配置");
  error.code = unusableCandidate ? "EACCES" : "ENOENT";
  throw error;
}
