const MAX_MOMENT_LOCATION_LENGTH = 80;

/** 想法只保存可展示的城市文字，不保存浏览器提供的经纬度。 */
export function normalizeMomentLocation(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const location = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return location.length <= MAX_MOMENT_LOCATION_LENGTH ? location : null;
}

/** 从 Nominatim 反查结果中取可作为公开位置展示的城市级名称。 */
export function cityFromReverseGeocode(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = (value as { address?: unknown }).address;
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const fields = address as Record<string, unknown>;
  for (const key of ["city", "municipality", "town"]) {
    const city = normalizeMomentLocation(fields[key]);
    if (city) return city;
  }
  return "";
}
