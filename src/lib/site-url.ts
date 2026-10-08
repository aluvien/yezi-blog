/** Canonical website origin, shared by settings validation and server readers. */
export function normalizeSiteUrl(value: string): string {
  const input = value.trim();
  if (!input) return "";
  if (input.length > 2048 || !/^https?:\/\//i.test(input) || /[\\\s]/.test(input)) throw new Error("网站地址须为完整的 HTTP/HTTPS 地址，例如 https://yezi.me");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("网站地址格式无效"); }
  if (!["http:", "https:"].includes(url.protocol) || !/^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])$/i.test(url.hostname) || url.hostname.length > 253 || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("网站地址只能包含协议、域名和端口，不能包含账号、路径或查询参数");
  }
  return url.origin;
}
