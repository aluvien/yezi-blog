/**
 * 主题系统：配色方案与深色模式选项。
 * 配色实际值定义在 globals.css 的 [data-palette]/[data-theme] 变量块中，
 * 这里的元数据仅供后台设置页渲染选择器与预览色块。
 */

export interface ThemePalette {
  id: string;
  name: string;
  description: string;
  lightAccent: string;
  darkAccent: string;
  lightBackground: string;
  darkBackground: string;
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    id: "default",
    name: "砖红 · 默认",
    description: "暖白底 + 砖红点缀，本站原配色",
    lightAccent: "#c25f3d",
    darkAccent: "#d97b5a",
    lightBackground: "#f7f7f9",
    darkBackground: "#161618",
  },
  {
    id: "ocean",
    name: "青绿",
    description: "清爽的蓝绿色调",
    lightAccent: "#0d9488",
    darkAccent: "#2dd4bf",
    lightBackground: "#f6faf9",
    darkBackground: "#0e1615",
  },
  {
    id: "indigo",
    name: "墨蓝",
    description: "沉稳的靛蓝色调",
    lightAccent: "#6366f1",
    darkAccent: "#818cf8",
    lightBackground: "#f7f8fd",
    darkBackground: "#131320",
  },
  {
    id: "forest",
    name: "森林",
    description: "自然的绿色调",
    lightAccent: "#16a34a",
    darkAccent: "#4ade80",
    lightBackground: "#f8faf6",
    darkBackground: "#12150f",
  },
  {
    id: "amber",
    name: "暖阳",
    description: "温暖的琥珀色调",
    lightAccent: "#d97706",
    darkAccent: "#f59e0b",
    lightBackground: "#fdf9f3",
    darkBackground: "#171310",
  },
];

export const THEME_PALETTE_IDS = THEME_PALETTES.map((palette) => palette.id);

export const DARK_MODE_OPTIONS = [
  { value: "auto", label: "跟随系统", description: "根据设备系统外观自动切换" },
  { value: "light", label: "浅色", description: "始终使用浅色外观" },
  { value: "dark", label: "深色", description: "始终使用深色外观" },
] as const;

export type DarkMode = (typeof DARK_MODE_OPTIONS)[number]["value"];

/** 从站点设置中取配色方案 id，非法值回退默认。 */
export function normalizePalette(raw: string | undefined): string {
  return raw && THEME_PALETTE_IDS.includes(raw) ? raw : "default";
}

/** 从站点设置中取深色模式选项，非法值回退 auto。 */
export function normalizeDarkMode(raw: string | undefined): DarkMode {
  return DARK_MODE_OPTIONS.some((option) => option.value === raw)
    ? (raw as DarkMode)
    : "auto";
}
