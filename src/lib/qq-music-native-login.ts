import fs from "node:fs";
import path from "node:path";
import { QQ_MUSIC_APP_SOURCE, type ServiceSource, withSource } from "@/lib/service-source";

const EXPECTED_PACKAGE_VERSION = "3.1.0";
const PACKAGE_NAME = "@yakult-green-tea/qq-music-api";
const NATIVE_QR_TTL_MS = 3 * 60 * 1000;

function createOpaqueRuntimeRequire(): NodeJS.Require {
  // This project requires Node 22. process.getBuiltinModule is deliberately
  // accessed through reflection so webpack cannot replace createRequire() and
  // subsequent dynamic loads with its own empty module context.
  const getBuiltinModule = Reflect.get(process, "getBuiltinModule") as unknown;
  if (typeof getBuiltinModule !== "function") {
    throw new Error(withSource("当前 Node.js 版本不支持 QQ 音乐原生登录", QQ_MUSIC_APP_SOURCE));
  }
  const moduleApi = Reflect.apply(getBuiltinModule, process, ["node:module"]) as typeof import("node:module");
  // Anchor lookup at the actual running release. import.meta.url is replaced
  // by webpack with the build machine's absolute source path, which is invalid
  // on the production server. Both the release root and Next standalone root
  // contain a package.json beside their traced node_modules directory.
  return moduleApi.createRequire(path.join(process.cwd(), "package.json"));
}

const runtimeRequire = createOpaqueRuntimeRequire();

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

type NativeQrCoreModule = {
  createQrLoginService(dependencies: {
    http: unknown;
    createSessionHttp(): unknown;
    deviceRepository: unknown;
    listen: unknown;
    randomBytes(size: number): Buffer;
  }): NativeQrService;
  createMqttListen(webSocket: unknown): unknown;
};

type NativeHttpClientModule = {
  default(): unknown;
};

type NativeDeviceContextModule = {
  createFileDeviceContextRepository(filePath: string): unknown;
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

function environmentText(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve a file path only from actual strings. Some process managers can pass
 * typed values through their in-memory environment object; treating a port
 * number as a filesystem path was the source of the `Received type number`
 * failure during QQ Music App QR bootstrap.
 */
export function resolveNativeQQMusicDevicePath(
  env: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string {
  const configured = environmentText(env, "QQ_MUSIC_NATIVE_DEVICE_PATH");
  if (configured) return path.resolve(configured);
  const dbPath = environmentText(env, "BLOG_DB_PATH");
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(workingDirectory, "data");
  return path.join(dataDir, "qq-music-native-device.json");
}

/**
 * Keep package resolution opaque to webpack. A direct
 * `runtimeRequire.resolve("…/package.json")` is rewritten in the production
 * route bundle to webpack's numeric module id (for example 62079), which then
 * crashes as soon as it reaches path.dirname().
 */
export function resolveNativeQQMusicPackageJsonPath(): string {
  const resolver = Reflect.get(runtimeRequire, "resolve") as unknown;
  if (typeof resolver !== "function") {
    throw new Error(withSource("QQ 音乐原生登录模块无法解析", QQ_MUSIC_APP_SOURCE));
  }
  const specifier = [PACKAGE_NAME, "package.json"].join("/");
  const resolved = Reflect.apply(resolver, runtimeRequire, [specifier]) as unknown;
  if (typeof resolved !== "string" || !resolved) {
    throw new Error(withSource("QQ 音乐原生登录模块路径无效", QQ_MUSIC_APP_SOURCE));
  }
  return resolved;
}

function nativeService(): NativeQrService {
  if (service) return service;
  const packageJsonPath = resolveNativeQQMusicPackageJsonPath();
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (packageJson.version !== EXPECTED_PACKAGE_VERSION) {
    throw new Error(withSource(
      `QQ 音乐原生登录模块版本不匹配（需要 ${EXPECTED_PACKAGE_VERSION}）`,
      QQ_MUSIC_APP_SOURCE,
    ));
  }

  // Do not load the package root (it starts a Koa listener) nor its Node
  // composition module (it reads QQ_AUTH_STATE_PATH from a mutable process
  // environment). Compose the documented QR primitives with our validated path
  // instead, leaving the existing localhost:3200 music sidecar untouched.
  const authDirectory = path.join(packageRoot, "dist", "src", "services", "auth");
  const core = Reflect.apply(runtimeRequire, undefined, [path.join(authDirectory, "qrLogin.js")]) as NativeQrCoreModule;
  const httpClient = Reflect.apply(runtimeRequire, undefined, [path.join(authDirectory, "httpClient.js")]) as NativeHttpClientModule;
  const deviceContext = Reflect.apply(runtimeRequire, undefined, [path.join(authDirectory, "deviceContext.js")]) as NativeDeviceContextModule;
  const crypto = runtimeRequire("node:crypto") as typeof import("node:crypto");
  const webSocket = runtimeRequire("ws") as unknown;
  const created = core.createQrLoginService({
    http: httpClient.default(),
    createSessionHttp: httpClient.default,
    deviceRepository: deviceContext.createFileDeviceContextRepository(resolveNativeQQMusicDevicePath()),
    listen: core.createMqttListen(webSocket),
    randomBytes: crypto.randomBytes,
  });
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
}

/** Initialize the exact standalone runtime closure without contacting QQ. */
export function validateNativeQQMusicRuntime(): void {
  void nativeService();
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
