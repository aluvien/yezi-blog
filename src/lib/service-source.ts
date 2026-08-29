export type ServiceSource = {
  label: string;
  website: string;
};

export const QQ_LOGIN_SOURCE: ServiceSource = {
  label: "QQ 登录",
  website: "ssl.ptlogin2.qq.com",
};

export const QQ_MUSIC_APP_SOURCE: ServiceSource = {
  label: "QQ 音乐 App",
  website: "u.y.qq.com / mu.y.qq.com",
};

export const QQ_MUSIC_WEB_SOURCE: ServiceSource = {
  label: "QQ 音乐网页",
  website: "y.qq.com",
};

export const TELEGRAM_SOURCE: ServiceSource = {
  label: "Telegram API",
  website: "api.telegram.org",
};

export function sourceLabel(source: ServiceSource): string {
  return `来源：${source.label}（${source.website}）`;
}

/** Add a diagnosable source without duplicating it across nested error handlers. */
export function withSource(message: string, source: ServiceSource): string {
  const text = message.trim() || "请求失败";
  return text.includes(source.website) ? text : `${text}；${sourceLabel(source)}`;
}
