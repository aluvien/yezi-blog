import fs from "node:fs";
import path from "node:path";
import { approveComment, getComment, updateCommentReply } from "@/lib/db";
import { findString, qqMusicRequest, readUin } from "@/lib/qq-music-api";
import { saveQQMusicSession } from "@/lib/qq-music-session";
import {
  answerTelegramCallback,
  getTelegramUpdates,
  isTelegramAdminChat,
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramPhoto,
} from "@/lib/telegram";

type JsonRecord = Record<string, unknown>;

type PendingQQLogin = {
  chatId: string;
  qrsig: string;
  ptqrtoken: string;
  expiresAt: number;
};

type PendingCommentReply = {
  commentId: number;
  expiresAt: number;
};

type TelegramBotState = {
  offset?: number;
  pendingQQLogin?: PendingQQLogin;
  pendingCommentReplies?: Record<string, PendingCommentReply>;
};

const QR_LOGIN_TTL_MS = 2 * 60 * 1000;
const COMMENT_REPLY_TTL_MS = 5 * 60 * 1000;
const INITIAL_UPDATE_WINDOW_SECONDS = 120;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength = 20_000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function botStatePath(): string {
  const dbPath = process.env.BLOG_DB_PATH?.trim();
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(process.cwd(), "data");
  return path.join(dataDir, "telegram-bot-state.json");
}

function readState(): TelegramBotState {
  try {
    const raw = JSON.parse(fs.readFileSync(botStatePath(), "utf8")) as TelegramBotState;
    const pendingQQLogin = raw.pendingQQLogin;
    const pendingCommentReplies = Object.fromEntries(Object.entries(raw.pendingCommentReplies ?? {}).flatMap(([chatId, pending]) => {
      if (!pending || !/^[-\d]{1,24}$/.test(chatId) || !Number.isInteger(pending.commentId) || pending.commentId < 1 || !Number.isFinite(pending.expiresAt)) return [];
      return [[chatId, { commentId: pending.commentId, expiresAt: pending.expiresAt }]];
    }));
    return {
      ...(Number.isInteger(raw.offset) && (raw.offset as number) > 0 ? { offset: raw.offset } : {}),
      ...(pendingQQLogin && /^[-\d]{1,24}$/.test(pendingQQLogin.chatId) && pendingQQLogin.qrsig && pendingQQLogin.ptqrtoken && Number.isFinite(pendingQQLogin.expiresAt)
        ? { pendingQQLogin: pendingQQLogin } : {}),
      ...(Object.keys(pendingCommentReplies).length > 0 ? { pendingCommentReplies } : {}),
    };
  } catch {
    return {};
  }
}

function saveState(state: TelegramBotState): void {
  const destination = botStatePath();
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* atomic rename consumed it */ }
  }
}

function qrImage(value: unknown): string {
  const raw = findString(value, ["img", "image", "qrCode", "qrcode", "qr", "base64", "dataUrl"]);
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  return /^[a-zA-Z0-9+/=\s]+$/.test(raw) ? `data:image/png;base64,${raw.replace(/\s/g, "")}` : "";
}

function messageRecord(update: JsonRecord): JsonRecord | null {
  return isRecord(update.message) ? update.message : null;
}

function messageChatId(message: JsonRecord): string {
  return isRecord(message.chat) ? stringValue(message.chat.id, 24) : "";
}

function messageDate(update: JsonRecord): number | null {
  const message = messageRecord(update) ?? (isRecord(update.callback_query) && isRecord(update.callback_query.message) ? update.callback_query.message : null);
  return message ? numberValue(message.date) : null;
}

function command(text: string): string {
  const [first] = text.trim().toLowerCase().split(/\s+/, 1);
  return first?.replace(/@[^\s]+$/, "") ?? "";
}

async function beginQQLogin(state: TelegramBotState, chatId: string): Promise<void> {
  try {
    const raw = await qqMusicRequest("/getQQLoginQr", { useSession: false });
    const image = qrImage(raw);
    const qrsig = findString(raw, ["qrsig"]);
    const ptqrtoken = findString(raw, ["ptqrtoken"]);
    if (!image || !qrsig) {
      await sendTelegramMessage("未能生成 QQ 音乐二维码，请检查本机 QQ 音乐服务。", { chatId });
      return;
    }
    const sent = await sendTelegramPhoto(chatId, image, "请用手机 QQ 扫码并确认登录。二维码约 2 分钟内有效，确认后我会自动回复登录结果。");
    if (!sent.ok) {
      await sendTelegramMessage(sent.error ?? "二维码发送失败，请稍后重试。", { chatId });
      return;
    }
    state.pendingQQLogin = { chatId, qrsig, ptqrtoken, expiresAt: Date.now() + QR_LOGIN_TTL_MS };
  } catch {
    await sendTelegramMessage("QQ 音乐服务暂不可用，暂时无法生成二维码。", { chatId });
  }
}

async function pollPendingQQLogin(state: TelegramBotState): Promise<void> {
  const pending = state.pendingQQLogin;
  if (!pending) return;
  if (pending.expiresAt <= Date.now()) {
    delete state.pendingQQLogin;
    await sendTelegramMessage("QQ 音乐二维码已过期，发送 /qqlogin 可重新获取。", { chatId: pending.chatId });
    return;
  }
  try {
    const raw = await qqMusicRequest("/checkQQLoginQr", {
      method: "POST",
      body: { qrsig: pending.qrsig, ptqrtoken: pending.ptqrtoken },
      useSession: false,
    });
    const cookie = findString(raw, ["cookie"]);
    const uin = readUin(raw);
    if (!cookie || !uin) return;
    saveQQMusicSession({ cookie, uin });
    delete state.pendingQQLogin;
    await sendTelegramMessage("✅ QQ 音乐登录成功，播放授权已更新。", { chatId: pending.chatId });
  } catch {
    // The next short polling tick retries; an upstream hiccup should not make
    // an in-progress QR login disappear.
  }
}

async function approveCommentFromBot(commentId: number, chatId: string): Promise<string> {
  const comment = getComment(commentId);
  if (!comment) return "这条评论已不存在。";
  if (comment.status === "approved") return "这条评论已经通过。";
  approveComment(commentId);
  await sendTelegramMessage(`✅ 已通过评论 #${commentId}。`, { chatId });
  return "评论已通过";
}

async function handleCallback(state: TelegramBotState, callback: JsonRecord): Promise<void> {
  const callbackId = stringValue(callback.id, 256);
  const data = stringValue(callback.data, 80);
  const message = isRecord(callback.message) ? callback.message : null;
  const chatId = message ? messageChatId(message) : "";
  if (!isTelegramAdminChat(chatId)) {
    await answerTelegramCallback(callbackId, "未授权");
    return;
  }

  if (data === "qq:login") {
    await answerTelegramCallback(callbackId, "正在发送二维码…");
    await beginQQLogin(state, chatId);
    return;
  }

  const match = /^comment:(approve|reply):(\d+)$/.exec(data);
  if (!match) {
    await answerTelegramCallback(callbackId, "操作无效");
    return;
  }
  const commentId = Number(match[2]);
  if (!Number.isSafeInteger(commentId) || commentId < 1) {
    await answerTelegramCallback(callbackId, "评论不存在");
    return;
  }
  if (match[1] === "approve") {
    const result = await approveCommentFromBot(commentId, chatId);
    await answerTelegramCallback(callbackId, result);
    return;
  }

  state.pendingCommentReplies = state.pendingCommentReplies ?? {};
  state.pendingCommentReplies[chatId] = { commentId, expiresAt: Date.now() + COMMENT_REPLY_TTL_MS };
  await answerTelegramCallback(callbackId, "请直接发送回复内容");
  await sendTelegramMessage(`请在 5 分钟内直接发送给 Bot 回复内容；收到后会自动回复并通过评论 #${commentId}。`, { chatId });
}

async function handleMessage(state: TelegramBotState, message: JsonRecord): Promise<void> {
  const chatId = messageChatId(message);
  if (!isTelegramAdminChat(chatId)) return;
  const text = stringValue(message.text, 1_000);
  if (!text) return;
  const action = command(text);
  if (action === "/start" || action === "/help") {
    await sendTelegramMessage("博客管理 Bot 已连接。\n/qqlogin - 获取 QQ 音乐授权二维码\n/cancel - 取消当前评论回复或 QQ 登录", { chatId });
    return;
  }
  if (action === "/qqlogin") {
    await beginQQLogin(state, chatId);
    return;
  }
  if (action === "/cancel") {
    if (state.pendingQQLogin?.chatId === chatId) delete state.pendingQQLogin;
    if (state.pendingCommentReplies?.[chatId]) delete state.pendingCommentReplies[chatId];
    await sendTelegramMessage("已取消当前操作。", { chatId });
    return;
  }
  if (action.startsWith("/")) {
    await sendTelegramMessage("可用命令：/qqlogin、/cancel。", { chatId });
    return;
  }

  const pending = state.pendingCommentReplies?.[chatId];
  if (!pending) return;
  if (pending.expiresAt <= Date.now()) {
    delete state.pendingCommentReplies?.[chatId];
    await sendTelegramMessage("评论回复已超时，请重新点击“回复并通过”。", { chatId });
    return;
  }
  const comment = getComment(pending.commentId);
  delete state.pendingCommentReplies?.[chatId];
  if (!comment) {
    await sendTelegramMessage("这条评论已不存在。", { chatId });
    return;
  }
  updateCommentReply(comment.id, text.slice(0, 1_000));
  approveComment(comment.id);
  await sendTelegramMessage(`✅ 已回复并通过评论 #${comment.id}。`, { chatId });
}

/** Poll administrator commands and callbacks. Called by the in-process scheduler. */
export async function processTelegramBotUpdates(): Promise<void> {
  if (!isTelegramConfigured()) return;
  const state = readState();
  const firstPoll = !state.offset;
  const updates = await getTelegramUpdates(state.offset);
  if (!updates.ok) return;
  const nowSeconds = Math.floor(Date.now() / 1_000);

  for (const raw of updates.updates) {
    if (!isRecord(raw)) continue;
    const updateId = numberValue(raw.update_id);
    if (updateId !== null) state.offset = Math.max(state.offset ?? 0, updateId + 1);
    // Do not revive old approval/reply actions the first time a server starts.
    const createdAt = messageDate(raw);
    if (firstPoll && createdAt !== null && createdAt < nowSeconds - INITIAL_UPDATE_WINDOW_SECONDS) continue;
    if (isRecord(raw.callback_query)) await handleCallback(state, raw.callback_query);
    else if (isRecord(raw.message)) await handleMessage(state, raw.message);
  }

  await pollPendingQQLogin(state);
  saveState(state);
}
