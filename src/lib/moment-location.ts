const MAX_MOMENT_LOCATION_LENGTH = 80;

const CITY_LEVEL_SUFFIX = /(?:自治州|地区|盟|市)$/u;
const DISTRICT_SUFFIX = /(?:区|县|旗|街道|乡|镇|村|社区)$/u;
const ENGLISH_CITY_SUFFIX = /(?:city|prefecture|municipality|province)$/iu;
const ENGLISH_DISTRICT_SUFFIX = /(?:district|county|township|town|village)$/iu;

/** 想法只保存可展示的城市文字，不保存浏览器提供的经纬度。 */
export function normalizeMomentLocation(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const location = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return location.length <= MAX_MOMENT_LOCATION_LENGTH ? location : null;
}

function asLocation(value: unknown): string {
  return normalizeMomentLocation(value) ?? "";
}

function isDistrict(value: string): boolean {
  return DISTRICT_SUFFIX.test(value) || ENGLISH_DISTRICT_SUFFIX.test(value);
}

function isCityLevel(value: string): boolean {
  return (CITY_LEVEL_SUFFIX.test(value) || ENGLISH_CITY_SUFFIX.test(value)) && !isDistrict(value);
}

/** 从 Nominatim 反查结果中取可作为公开位置展示的城市级名称。 */
export function cityFromReverseGeocode(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = (value as { address?: unknown }).address;
  const fields = address && typeof address === "object" && !Array.isArray(address)
    ? address as Record<string, unknown>
    : {};

  // 在中国地址中，Nominatim 偶尔会把当前区县放进 address.city；先排除
  // 这类行政区，再使用真正的市级字段。
  for (const key of ["city", "municipality", "state_district"]) {
    const city = asLocation(fields[key]);
    if (city && isCityLevel(city)) return city;
  }

  // zoom=10 的结果常把区县作为 city，但 display_name 仍包含“杭州市”等
  // 上级城市。按从近到远的顺序找第一个城市级片段，避免把区名公开出去。
  const displayName = asLocation((value as { display_name?: unknown }).display_name);
  if (displayName) {
    for (const part of displayName.split(/[,，、]/u)) {
      const city = part.trim();
      if (city && isCityLevel(city)) return city;
    }
  }

  // 非中文返回（例如 Hangzhou）未必带“市”，保留明确的 city/municipality
  // 字段作为最后兜底；town/county 则不作为所在地级市展示。
  for (const key of ["city", "municipality"]) {
    const city = asLocation(fields[key]);
    if (city && !isDistrict(city)) return city;
  }
  return "";
}
