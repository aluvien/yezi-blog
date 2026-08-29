import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { QQ_MUSIC_APP_SOURCE, type ServiceSource, withSource } from "@/lib/service-source";

const EXPECTED_PACKAGE_VERSION = "3.1.0";
const NATIVE_QR_TTL_MS = 3 * 60 * 1000;
const runtimeRequire = createRequire(import.meta.url);

type NativeCredential = Record<string, unknown>;

type NativeAuthSession = {
  token: string;
  credential: NativeCredential;
  device: Record<string, unknown>;
  expiresAt: number;
};

type NativeQrCheck = {
  code: 800 | 801 | 802 | 803;
  message: string;
  cookie?: string;
  retryAfterMs?: number;
  upstreamCode?: number;
};

type NativeQrService = {
  createSession(channel?: "qq"): Promise<string>;
  createQr(key: string): Promise<string>;
  checkQr(key: string): Promise<NativeQrCheck>;
  cancelSession(key: string): void;
  configureAuthSessionRepository(repository: {
    readonly kind: string;
    load(): unknown;
    save(sessions: readonly NativeAuthSession[]): void;
  }): void;
};

type NativeQrModule = {
  createNodeQrLoginService(): NativeQrService;
};

export type NativeQQMusicQr = {
  key: string;
  image: string;
  expiresAt: number;
  source: ServiceSource;
};

export type NativeQQMusicPollResult = {
  state: "pending" | "scanned" | "success" | "expired";
  message: string;
  source: ServiceSource;
  cookie?: string;
  uin?: string;
  retryAfterMs?: number;
  upstreamCode?: number;
};

let service: NativeQrService | null = null;
let capturedSessions: readonly NativeAuthSession[] = [];

function nativeDevicePath(): string {
  const configured = process.env.QQ_MUSIC_NATIVE_DEVICE_PATH?.trim();
  if (configured) return path.resolve(configured);
  const dbPath = process.env.BLOG_DB_PATH?.trim();
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(process.cwd(), "data");
  return path.join(dataDir, "qq-music-native-device.json");
}

function nativeService(): NativeQrService {
  if (service) return service;
  const packageJsonPath = runtimeRequire.resolve("@yakult-green-tea/qq-music-api/package.json");
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (packageJson.version !== EXPECTED_PACKAGE_VERSION) {
    throw new Error(withSource(
      `QQ 音乐原生登录模块版本不匹配（需要 ${EXPECTED_PACKAGE_VERSION}）`,
      QQ_MUSIC_APP_SOURCE,
    ));
  }

  // The package's public root starts its own Koa listener. Load only its Node QR
  // composition module so the existing localhost:3200 sidecar remains untouched.
  const modulePath = path.join(packageRoot, "dist", "src", "services", "auth", "qrLogin.node.js");
  const previousDevicePath = process.env.QQ_AUTH_STATE_PATH;
  process.env.QQ_AUTH_STATE_PATH = nativeDevicePath();
  try {
    // Reflect keeps webpack from trying to bundle an absolute runtime path; the
    // exact package closure is copied by outputFileTracingIncludes instead.
    const nativeModule = Reflect.apply(runtimeRequire, undefined, [modulePath]) as NativeQrModule;
    const created = nativeModule.createNodeQrLoginService();
    created.configureAuthSessionRepository({
      kind: "yezi-capture",
      load: () => capturedSessions,
      save: (sessions) => {
        capturedSessions = sessions.map((session) => ({
          ...session,
          credential: { ...session.credential },
          device: { ...session.device },
        }));
      },
    });
    service = created;
    return created;
  } finally {
    if (previousDevicePath === undefined) delete process.env.QQ_AUTH_STATE_PATH;
    else process.env.QQ_AUTH_STATE_PATH = previousDevicePath;
  }
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function safeCookieValue(value: unknown, maxLength: number): string {
  const text = scalar(value);
  return text && text.length <= maxLength && !/[;\r\n\u0000]/.test(text) ? text : "";
}

/** Convert the native credential into the web-cookie form accepted by the existing sidecar. */
export function qqMusicCredentialCookie(credential: NativeCredential): { cookie: string; uin: string } | null {
  const uin = safeCookieValue(credential.str_musicid, 16) || safeCookieValue(credential.musicid, 16);
  const key = safeCookieValue(credential.musickey, 4096);
  if (!/^\d{5,16}$/.test(uin) || !key) return null;
  const loginType = safeCookieValue(credential.loginType, 8) || "6";
  return {
    uin,
    cookie: [
      `uin=${uin}`,
      `qqmusic_uin=${uin}`,
      `qm_keyst=${key}`,
      `qqmusic_key=${key}`,
      `tmeLoginType=${loginType}`,
    ].join("; "),
  };
}

function credentialForCheck(checkCookie: string): NativeCredential | null {
  const token = /(?:^|;\s*)qqmusic_session=([^;\s]+)/.exec(checkCookie)?.[1] ?? "";
  if (!token) return null;
  return capturedSessions.find((session) => session.token === token)?.credential ?? null;
}

function validKey(key: string): boolean {
  return /^[a-f0-9]{48}$/i.test(key);
}

export async function createNativeQQMusicQr(): Promise<NativeQQMusicQr> {
  const current = nativeService();
  const key = await current.createSession("qq");
  const image = await current.createQr(key);
  if (!validKey(key) || !image.startsWith("data:image/png;base64,")) {
    current.cancelSession(key);
    throw new Error(withSource("QQ 音乐没有返回有效二维码", QQ_MUSIC_APP_SOURCE));
  }
  return { key, image, expiresAt: Date.now() + NATIVE_QR_TTL_MS, source: QQ_MUSIC_APP_SOURCE };
}

export async function pollNativeQQMusicQr(key: string): Promise<NativeQQMusicPollResult> {
  if (!validKey(key)) throw new Error(withSource("QQ 音乐二维码信息无效", QQ_MUSIC_APP_SOURCE));
  const result = await nativeService().checkQr(key);
  if (result.code === 803 && result.cookie) {
    const credential = credentialForCheck(result.cookie);
    const login = credential ? qqMusicCredentialCookie(credential) : null;
    if (!login) throw new Error(withSource("QQ 音乐已确认登录，但未返回可保存的账号凭证", QQ_MUSIC_APP_SOURCE));
    return {
      state: "success",
      message: "QQ 音乐 App 扫码登录成功",
      source: QQ_MUSIC_APP_SOURCE,
      ...login,
    };
  }
  if (result.code === 802) {
    return { state: "scanned", message: "已扫码，请在 QQ 音乐 App 中确认登录", source: QQ_MUSIC_APP_SOURCE };
  }
  if (result.code === 800) {
    return {
      state: "expired",
      message: withSource("二维码已过期或登录失败，请重新生成", QQ_MUSIC_APP_SOURCE),
      source: QQ_MUSIC_APP_SOURCE,
      ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
      ...(result.upstreamCode === undefined ? {} : { upstreamCode: result.upstreamCode }),
    };
  }
  return { state: "pending", message: "等待使用 QQ 音乐 App 扫码", source: QQ_MUSIC_APP_SOURCE };
}

export function cancelNativeQQMusicQr(key: string): void {
  if (!validKey(key)) return;
  nativeService().cancelSession(key);
}
