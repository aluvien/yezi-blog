import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";

export type PushEnvironment = "development" | "production";
export type PushResult = { accepted: boolean; reason: string; disable?: boolean; retry?: boolean };
let cachedJWT: { value: string; issued: number; identity: string } | undefined;

export function pushConfiguration(): { configured: boolean; siteRoot: string } {
  let siteRoot = "";
  try {
    const url = new URL(process.env.APNS_SITE_URL || "");
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) siteRoot = url.origin;
  } catch { /* Unconfigured servers continue serving comments normally. */ }
  return { siteRoot, configured: Boolean(siteRoot && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && (process.env.APNS_PRIVATE_KEY || process.env.APNS_KEY_PATH)) };
}

/** ES256 uses the raw 64-byte signature required by JWT, not ASN.1 DER. */
export function createAPNsJWT(pem: string, keyID: string, teamID: string, issued = Math.floor(Date.now() / 1000)): string {
  const head = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyID })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: teamID, iat: issued })).toString("base64url");
  const input = `${head}.${body}`;
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Invalid APNs signing key");
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function providerToken(): string {
  const identity = `${process.env.APNS_KEY_ID}:${process.env.APNS_TEAM_ID}:${process.env.APNS_KEY_PATH}:${process.env.APNS_PRIVATE_KEY}`;
  const now = Math.floor(Date.now() / 1000);
  if (cachedJWT?.identity === identity && now - cachedJWT.issued < 3000) return cachedJWT.value;
  const pem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n") || readFileSync(process.env.APNS_KEY_PATH!, "utf8");
  const value = createAPNsJWT(pem, process.env.APNS_KEY_ID!, process.env.APNS_TEAM_ID!, now);
  cachedJWT = { value, issued: now, identity };
  return value;
}

export async function sendAPNs(token: string, environment: PushEnvironment, payload: string): Promise<PushResult> {
  if (!pushConfiguration().configured) return { accepted: false, reason: "NotConfigured", retry: true };
  if (Buffer.byteLength(payload) > 4096) return { accepted: false, reason: "PayloadTooLarge" };
  let jwt: string;
  try { jwt = providerToken(); } catch { return { accepted: false, reason: "SigningConfigurationError", retry: true }; }
  return new Promise((resolve) => {
    const client = connect(environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    let finished = false;
    const finish = (result: PushResult) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); client.destroy(); resolve(result);
    };
    const timeout = setTimeout(() => finish({ accepted: false, reason: "Timeout", retry: true }), 8000);
    client.on("error", () => finish({ accepted: false, reason: "ConnectionError", retry: true }));
    const request = client.request({
      ":method": "POST", ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`, "apns-topic": "me.aluvien.yeziblog",
      "apns-push-type": "alert", "apns-priority": "10",
      "apns-collapse-id": createHash("sha256").update(payload).digest("hex"),
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
    });
    let status = 0; let body = "";
    request.on("response", (headers) => { status = Number(headers[":status"]); });
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; if (body.length > 4096) finish({ accepted: false, reason: "InvalidResponse", retry: true }); });
    request.on("error", () => finish({ accepted: false, reason: "RequestError", retry: true }));
    request.on("end", () => {
      let reason = `HTTP${status}`;
      try { reason = String(JSON.parse(body).reason || reason).slice(0, 100); } catch { /* 200 has an empty body. */ }
      if (reason === "ExpiredProviderToken") cachedJWT = undefined;
      finish({ accepted: status === 200, reason: status === 200 ? "Accepted" : reason,
        disable: ["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason),
        retry: status === 429 || status >= 500 || status === 403 });
    });
    request.end(payload);
  });
}
