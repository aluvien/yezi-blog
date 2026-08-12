import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_CACHE_MS = 60_000;
const DNS_CACHE_LIMIT = 512;

type DnsCacheEntry = {
  expiresAt: number;
  addresses: string[];
};

const dnsCache = new Map<string, DnsCacheEntry>();

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  return bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? bytes : null;
}
function isBlockedIpv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (!bytes) return true;
  const [a, b, c] = bytes;
  return a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 0 && c === 0
    || a === 192 && b === 0 && c === 2
    || a === 192 && b === 88 && c === 99
    || a === 192 && b === 168
    || a === 198 && (b === 18 || b === 19)
    || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113
    || a >= 224;
}

function ipv6Bytes(input: string): number[] | null {
  const address = input.toLowerCase().split("%", 1)[0];
  if (!address || address.split("::").length > 2) return null;
  const [leftRaw, rightRaw = ""] = address.split("::");
  const parseGroups = (value: string): number[] | null => {
    if (!value) return [];
    const groups: number[] = [];
    for (const part of value.split(":")) {
      if (part.includes(".")) {
        const ipv4 = ipv4Bytes(part);
        if (!ipv4) return null;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  const left = parseGroups(leftRaw);
  const right = parseGroups(rightRaw);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!address.includes("::") && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function isBlockedIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((value) => value === 0);
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  if (allZero || loopback) return true;

  // IPv4-compatible and IPv4-mapped IPv6 must inherit the embedded IPv4 policy.
  const mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes.slice(0, 12).every((value) => value === 0);
  if (mapped || compatible) return isBlockedIpv4(bytes.slice(12).join("."));

  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const multicast = bytes[0] === 0xff;
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const benchmark = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x02;
  const orchid = bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xf0) === 0x10;
  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
  const nat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
  return uniqueLocal || linkLocal || multicast || documentation || benchmark || orchid || sixToFour || nat64;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const version = isIP(address.split("%", 1)[0]);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost") return true;
  if (["metadata.google.internal", "metadata.google", "instance-data.ec2.internal"].includes(host)) return true;
  return [".localhost", ".local", ".internal", ".lan", ".home.arpa"].some((suffix) => host.endsWith(suffix));
}

function normalizePublicHttpUrl(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 2_000) throw new Error("网址为空或过长");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入有效的 http 或 https 网址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("网址只支持 http 或 https");
  if (url.username || url.password || blockedHostname(url.hostname)) throw new Error("这个网址不允许读取");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isBlockedNetworkAddress(literal)) throw new Error("这个网址不允许读取");
  url.hash = "";
  return url.toString();
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  if (cached) dnsCache.delete(hostname);

  const result = await lookup(hostname, { all: true, verbatim: true });
  const addresses = [...new Set(result.map((item) => item.address))];
  if (addresses.length === 0) throw new Error("网址域名没有可用地址");
  if (dnsCache.size >= DNS_CACHE_LIMIT) dnsCache.delete(dnsCache.keys().next().value as string);
  dnsCache.set(hostname, { expiresAt: Date.now() + DNS_CACHE_MS, addresses });
  return addresses;
}

/**
 * Validate a remote URL immediately before every outbound request.
 *
 * URL text checks alone cannot stop a public-looking hostname from resolving to
 * 127.0.0.1 or a private network. Resolving every redirect closes that common
 * SSRF bypass while a short bounded DNS cache avoids repeated lookups for image
 * archives from the same article host.
 */
export async function assertPublicRemoteUrl(input: unknown): Promise<string> {
  const normalized = normalizePublicHttpUrl(input);
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return normalized;
  let addresses: string[];
  try {
    addresses = await resolveAddresses(hostname);
  } catch (error) {
    if (error instanceof Error && error.message === "网址域名没有可用地址") throw error;
    throw new Error("网址域名解析失败");
  }
  if (addresses.some(isBlockedNetworkAddress)) throw new Error("这个网址解析到了不允许访问的网络地址");
  return normalized;
}
