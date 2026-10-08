import fs from "node:fs";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { CloudBackupFile, CloudBackupTransfer } from "@/lib/cloud-backup-types";

export const CLOUD_FILE_PATTERN = /^yezi-complete-(\d{8}T\d{6}Z)-(?:([a-z0-9][a-z0-9.-]{0,99})-)?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tar\.gz\.enc$/;
export const MAX_CLOUD_BYTES = 2 * 1024 * 1024 * 1024;
const XML_LIMIT = 8 * 1024 * 1024;
const ALL_PROPERTIES = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>';
export type WebDavConfig = { endpoint: string; username: string; password: string; directory: string };

export function normalizeWebDavLocation(endpoint: string, directory: string): { endpoint: string; directory: string } {
  let url: URL;
  try { url = new URL(endpoint.trim()); } catch { throw new Error("请输入完整的 WebDAV 地址。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("WebDAV 地址只能使用 HTTP/HTTPS，不能包含账号、查询参数或片段。");
  }
  const pieces = directory.trim().split("/").filter(Boolean);
  if (pieces.some(part => part === "." || part === ".." || /[\\\x00-\x1f\x7f]/.test(part)) || directory.length > 500 || endpoint.length > 2000) throw new Error("备份目录格式无效。");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return { endpoint: url.toString(), directory: pieces.join("/") };
}
function objects(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter(item => item && typeof item === "object") as Record<string, unknown>[];
}
function property(response: Record<string, unknown>): Record<string, unknown> | null {
  for (const part of objects(response.propstat)) {
    if (typeof part.status === "string" && /\s200(?:\s|$)/.test(part.status)) return objects(part.prop)[0] ?? null;
  }
  return null;
}
export function parseDavResponses(xml: string): Record<string, unknown>[] {
  if (Buffer.byteLength(xml) > XML_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("WebDAV 返回的目录格式无效。");
  const parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml);
  if (!parsed?.multistatus) throw new Error("WebDAV 未返回有效的目录列表。");
  return objects(parsed.multistatus.response);
}
export function webDavDirectoryUrl(config: WebDavConfig): URL {
  const location = normalizeWebDavLocation(config.endpoint, config.directory);
  return new URL(location.directory ? `${location.directory.split("/").map(encodeURIComponent).join("/")}/` : "", location.endpoint);
}
export class WebDavClient {
  readonly directory: URL;
  private readonly config: WebDavConfig;
  constructor(config: WebDavConfig) { this.config = config; this.directory = webDavDirectoryUrl(config); }
  private child(name: string): URL {
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error("远程文件名无效。");
    return new URL(encodeURIComponent(name), this.directory);
  }
  private async request(url: URL, method: string, options: RequestInit = {}, accepted = [200, 201, 204, 207]): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...options, method, redirect: "manual", cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(["PROPFIND", "MKCOL"].includes(method) ? 30_000 : 15 * 60_000), ...(options.signal ? [options.signal] : [])]),
        headers: { ...options.headers, Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}` },
      });
    } catch { throw new Error("无法连接 WebDAV，请检查地址、证书和网络连接。"); }
    if (!accepted.includes(response.status)) {
      await response.body?.cancel();
      const detail = response.status === 401 ? "账号或密码未通过认证" : response.status === 403 ? "账号没有所需权限" : response.status === 404 ? "目录或文件不存在" : response.status === 405 ? "此目录不允许该操作" : response.status === 413 ? "上传内容超过 WebDAV 服务或反向代理的大小限制，请调大接收端上传限制" : response.status >= 300 && response.status < 400 ? "地址发生重定向，请填写最终 WebDAV 地址" : "服务器拒绝请求";
      throw new Error(`WebDAV ${method} 失败（${response.status}）：${detail}。`);
    }
    return response;
  }
  private async readXml(response: Response): Promise<string> {
    if (!response.body) throw new Error("WebDAV 目录响应为空。");
    let size = 0;
    const pieces: Buffer[] = [];
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      size += chunk.length;
      if (size > XML_LIMIT) throw new Error("WebDAV 目录过大，请使用独立的备份目录。");
      pieces.push(Buffer.from(chunk));
    }
    return Buffer.concat(pieces).toString("utf8");
  }
  private async properties(url: URL, depth: "0" | "1"): Promise<Record<string, unknown>[]> {
    // fnOS rejects some selective-property requests with 404. allprop works at both depths.
    const response = await this.request(url, "PROPFIND", { headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, body: ALL_PROPERTIES }, [207]);
    return parseDavResponses(await this.readXml(response));
  }
  async ensureDirectory(): Promise<void> {
    try {
      const responses = await this.properties(this.directory, "0");
      if (!responses.some(item => property(item)?.resourcetype !== undefined && JSON.stringify(property(item)?.resourcetype).includes("collection"))) throw new Error("备份路径不是目录。");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("（404）")) throw error;
      const created = await this.request(this.directory, "MKCOL", {}, [201]);
      await created.body?.cancel();
      await this.properties(this.directory, "0");
    }
  }
  async list(): Promise<CloudBackupFile[]> {
    const responses = await this.properties(this.directory, "1");
    const files: CloudBackupFile[] = [];
    for (const item of responses) {
      if (typeof item.href !== "string") continue;
      let url: URL;
      let name: string;
      try { url = new URL(item.href, this.directory); name = decodeURIComponent(url.pathname.slice(this.directory.pathname.length)); } catch { continue; }
      if (url.origin !== this.directory.origin || !url.pathname.startsWith(this.directory.pathname) || !CLOUD_FILE_PATTERN.test(name) || url.search || url.hash) continue;
      const prop = property(item);
      if (!prop || JSON.stringify(prop.resourcetype)?.includes("collection")) continue;
      const sizeBytes = Number(prop.getcontentlength);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) continue;
      const match = CLOUD_FILE_PATTERN.exec(name)!;
      const stamp = match[1];
      const createdAt = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
      if (!Number.isFinite(Date.parse(createdAt))) continue;
      files.push({ name, sizeBytes, createdAt, ...(match[2] ? { site: match[2] } : {}) });
    }
    return files.sort((a, b) => b.name.localeCompare(a.name));
  }
  async upload(name: string, file: string, onProgress?: (progress: CloudBackupTransfer) => void): Promise<void> {
    const size = fs.statSync(file).size;
    if (size <= 0 || size > MAX_CLOUD_BYTES) throw new Error("备份文件为空或超过 2 GB 上限。");
    const source = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
    const controller = new AbortController();
    const started = performance.now();
    let transferred = 0;
    let progressError: unknown;
    const report = () => {
      const elapsedSeconds = Math.max(0, (performance.now() - started) / 1000);
      const bytesPerSecond = elapsedSeconds > 0 ? transferred / elapsedSeconds : 0;
      onProgress?.({ totalBytes: size, transferredBytes: transferred, bytesPerSecond, elapsedSeconds, remainingSeconds: bytesPerSecond > 0 ? (size - transferred) / bytesPerSecond : null });
    };
    const timer = onProgress ? setInterval(() => {
      try { report(); } catch (error) { progressError = error; controller.abort(); }
    }, 1000) : null;
    timer?.unref();
    // Count bytes pulled by the HTTP upload stream, respecting backpressure.
    // Completion still requires the DAV response and subsequent remote hash verification.
    const body = Readable.from((async function* () {
      for await (const chunk of source) { transferred += chunk.length; yield chunk; }
    })(), { objectMode: false, highWaterMark: 64 * 1024 });
    try {
      report();
      const response = await this.request(this.child(name), "PUT", {
        signal: controller.signal,
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size), "If-None-Match": "*" },
        body: Readable.toWeb(body, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } }) as BodyInit, duplex: "half",
      } as RequestInit, [200, 201, 204]);
      await response.body?.cancel();
      if (progressError) throw progressError;
      report();
    } catch (error) {
      report();
      throw progressError || error;
    } finally {
      if (timer) clearInterval(timer);
      source.destroy(); body.destroy();
    }
  }
  async streamDownload(name: string, expectedSize: number): Promise<ReadableStream<Uint8Array>> {
    if (!CLOUD_FILE_PATTERN.test(name) || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_CLOUD_BYTES) throw new Error("请选择有效的云备份文件，备份不可超过 2 GB。");
    const response = await this.request(this.child(name), "GET", {}, [200]);
    if (!response.body) throw new Error("远程备份响应为空。");
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== expectedSize) { await response.body.cancel(); throw new Error("远程备份大小发生变化，请刷新列表后重试。"); }
    let received = 0;
    return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > expectedSize) throw new Error("远程备份超过预期大小。");
        controller.enqueue(chunk);
      },
      flush() { if (received !== expectedSize) throw new Error("远程备份下载不完整。"); },
    }));
  }
  async download(name: string, destination: string): Promise<void> {
    const response = await this.request(this.child(name), "GET", {}, [200]);
    if (!response.body) throw new Error("远程备份响应为空。");
    if (Number(response.headers.get("content-length")) > MAX_CLOUD_BYTES) { await response.body.cancel(); throw new Error("远程备份超过 2 GB 上限。"); }
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) { size += chunk.length; done(size > MAX_CLOUD_BYTES ? new Error("远程备份超过 2 GB 上限。") : null, chunk); } });
    try { await pipeline(Readable.fromWeb(response.body as never), limit, fs.createWriteStream(destination, { flags: "wx", mode: 0o600 })); }
    catch { fs.rmSync(destination, { force: true }); throw new Error("远程备份下载失败，请检查网络和磁盘空间。"); }
  }
  async remove(name: string): Promise<void> {
    const response = await this.request(this.child(name), "DELETE", {}, [200, 204, 404]);
    await response.body?.cancel();
  }
  async test(directory: string): Promise<void> {
    await this.ensureDirectory();
    const name = `.yezi-connection-${crypto.randomUUID()}.txt`;
    const original = crypto.randomBytes(32);
    const local = `${directory}/${name}`;
    const returned = `${local}.download`;
    fs.writeFileSync(local, original, { mode: 0o600 });
    let uploaded = false;
    try {
      await this.upload(name, local);
      uploaded = true;
      await this.download(name, returned);
      if (!fs.readFileSync(returned).equals(original)) throw new Error("WebDAV 写入和读取内容不一致。");
      await this.properties(this.directory, "1");
    } finally {
      try { if (uploaded) await this.remove(name); } finally { fs.rmSync(local, { force: true }); fs.rmSync(returned, { force: true }); }
    }
  }
}
