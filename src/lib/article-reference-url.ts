export type XStatusUrl = {
  id: string;
  username: string;
  canonicalUrl: string;
};

/** 识别 X/Twitter 的公开动态链接，并去掉分享参数，保证缓存键稳定。 */
export function parseXStatusUrl(input: string): XStatusUrl | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "x.com" && hostname !== "twitter.com" && hostname !== "mobile.twitter.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const statusIndex = segments.findIndex((segment) => segment.toLowerCase() === "status");
  const id = statusIndex >= 0 ? segments[statusIndex + 1] || "" : "";
  if (!/^\d{6,30}$/.test(id)) return null;
  const owner = statusIndex > 0 ? segments[statusIndex - 1] : "";
  const isGenericOwner = !owner || owner.toLowerCase() === "i" || segments[statusIndex - 2]?.toLowerCase() === "i";
  const username = isGenericOwner ? "" : owner.replace(/^@/, "");
  const path = username ? `/${encodeURIComponent(username)}/status/${id}` : `/i/web/status/${id}`;
  return { id, username, canonicalUrl: `https://x.com${path}` };
}
