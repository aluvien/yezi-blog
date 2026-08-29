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

/**
 * 前台版式主题：与配色方案分开，避免切换布局时覆盖现有颜色设置。
 * classic 为书香双栏版式，editorial 对应新的编辑感布局。
 */
export const LAYOUT_THEMES = [
  {
    id: "classic",
    name: "经典版·书香",
    description: "左侧书写侧栏与右侧长卷阅读，适合安静浏览",
  },
  {
    id: "editorial",
    name: "编辑版 · 新视觉",
    description: "紧凑页头、连续标题区与无方框操作图标",
  },
] as const;

export const LAYOUT_THEME_IDS = LAYOUT_THEMES.map((theme) => theme.id);
export type LayoutTheme = (typeof LAYOUT_THEMES)[number]["id"];

/** 从站点设置中取前台版式主题，旧数据库或非法值回退当前经典版。 */
export function normalizeLayoutTheme(raw: string | undefined): LayoutTheme {
  return LAYOUT_THEME_IDS.includes(raw as LayoutTheme) ? (raw as LayoutTheme) : "classic";
}

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
