import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { LookupAddress, LookupOptions } from "node:dns";
import { assertPublicRemoteUrl, resolvePublicAddresses } from "@/lib/remote-url";

type SafeRemoteFetchOptions = {
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Node's built-in fetch does not expose a per-request DNS lookup callback.
 * Use the core HTTP clients here so a validated DNS answer is pinned to the
 * socket that is actually opened.  `agent: false` also forces a fresh lookup
 * for every redirect/request instead of reusing a socket resolved earlier.
 */
function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  void resolvePublicAddresses(hostname)
    .then((addresses) => {
      const requestedFamily = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : typeof options.family === "number" ? options.family : undefined;
      const filtered = addresses.filter((item) => !requestedFamily || requestedFamily === item.family);
      const selected = filtered[0];
      if (!selected) {
        const error = new Error("这个网址解析到了不允许访问的网络地址") as NodeJS.ErrnoException;
        error.code = "EHOSTUNREACH";
        callback(error, "", 0);
        return;
      }
      if (options.all) {
        callback(null, filtered);
        return;
      }
      callback(null, selected.address, selected.family);
    })
    .catch((error: unknown) => callback(error as NodeJS.ErrnoException, "", 0));
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * A GET-only, manual-redirect remote request for public HTTP(S) resources.
 * Callers keep control of response-size limits and redirect counts while this
 * helper owns URL validation, DNS pinning, abort handling and stream bridging.
 */
export async function safeRemoteFetch(input: string, options: SafeRemoteFetchOptions = {}): Promise<Response> {
  const normalized = await assertPublicRemoteUrl(input);
  const url = new URL(normalized);
  const headers = Object.fromEntries(new Headers(options.headers).entries());

  return new Promise<Response>((resolve, reject) => {
    let request: http.ClientRequest | null = null;
    let response: http.IncomingMessage | null = null;
    let settled = false;
    let aborted = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled && !response) return;
      aborted = true;
      request?.destroy();
      response?.destroy();
      if (!settled) {
        settled = true;
        cleanup();
        reject(abortError());
      }
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const requestOptions: http.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname || "/"}${url.search}`,
      method: "GET",
      headers,
      lookup: publicLookup,
      agent: false,
    };
    const handleResponse = (incoming: http.IncomingMessage) => {
        response = incoming;
        if (aborted) {
          incoming.destroy();
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        settled = true;
        // Keep the abort listener until the body stream closes.  If the caller
        // times out while reading a large response, the socket is destroyed.
        const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        const finish = () => cleanup();
        incoming.once("close", finish);
        resolve(new Response(body, {
          status: incoming.statusCode ?? 0,
          statusText: incoming.statusMessage ?? "",
          headers: responseHeaders,
        }));
    };
    request = url.protocol === "https:"
      ? https.request({ ...requestOptions, servername: url.hostname }, handleResponse)
      : http.request(requestOptions, handleResponse);

    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(aborted ? abortError() : error);
    });
    if (options.timeoutMs && options.timeoutMs > 0) {
      request.setTimeout(options.timeoutMs, () => request?.destroy(new Error("远程请求超时")));
    }
    request.end();
  });
}
