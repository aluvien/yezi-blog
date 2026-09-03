// GitHub 仓库标识解析与规范化（纯逻辑，不联网）。
//
// 安全边界：只接受 github.com 的仓库，绝不把任意 URL 当作可请求的 GitHub 资源。
// 调用方拿到 { owner, name } 后，元数据同步固定请求 https://api.github.com/repos/{owner}/{name}，
// 服务端从不使用用户提供的完整 URL 作为 fetch 目标，避免 SSRF。

export interface GithubRepositoryRef {
  owner: string;
  name: string;
  /** 归一化小写，用作数据库唯一键。 */
  fullName: string;
  /** 展示与跳转用的规范地址（保留原始大小写）。 */
  repoUrl: string;
}

// GitHub 用户名：1–39 位，字母数字或连字符，不能以连字符开头/结尾，不能连续连字符。
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// 仓库名：允许字母数字以及 . _ -，但不能以 . 或 - 开头，允许结尾 .git 之外的常规字符。
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function toRef(owner: string, name: string): GithubRepositoryRef | null {
  const cleanOwner = owner.replace(/^@/, "").trim();
  const cleanName = name.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!OWNER_PATTERN.test(cleanOwner) || !NAME_PATTERN.test(cleanName)) return null;
  const fullName = `${cleanOwner.toLowerCase()}/${cleanName.toLowerCase()}`;
  return {
    owner: cleanOwner,
    name: cleanName,
    fullName,
    repoUrl: `https://github.com/${cleanOwner}/${cleanName}`,
  };
}

/**
 * 接受完整 URL（https://github.com/owner/repo）或简写（owner/repo）。
 * 忽略末尾的 "/"、".git"、以及 GitHub 允许的尾随片段（如 tree/...）。
 * 任何 github.com 之外的主机、协议或非法字符都返回 null。
 */
export function parseGithubRepositoryRef(input: unknown): GithubRepositoryRef | null {
  const value = String(input ?? "").trim();
  if (!value || value.length > 2_000) return null;

  // 简写形式：owner/repo（不含协议与主机）。
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.includes("/")) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const shorthand = value.split("/").filter(Boolean);
    if (shorthand.length < 2) return null;
    return toRef(shorthand[0], shorthand[1]);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  // 只取前两段 owner/repo，容忍用户粘贴带 tab/tree 的长链接。
  return toRef(segments[0], segments[1]);
}

export function githubRepositoryApiUrl(ref: GithubRepositoryRef): string {
  return `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
}
