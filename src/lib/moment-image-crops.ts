/** Position is a fraction of the overflow, matching CSS object-position. */
export type MomentImageCrop = { x: number; y: number; zoom: number; aspectRatio?: number; originalAspectRatio?: number };
export type MomentImageCrops = Record<string, MomentImageCrop>;

export function normalizeMomentImageCrops(value: unknown, images: string[]): MomentImageCrops | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: MomentImageCrops = Object.create(null);
  const entries = Object.entries(value);
  if (entries.length > 9) return null;
  for (const [path, raw] of entries) {
    if (!images.includes(path)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const { x, y, zoom } = raw as MomentImageCrop;
    if (![x, y, zoom].every((n) => typeof n === "number" && Number.isFinite(n)) || x < 0 || x > 1 || y < 0 || y > 1 || zoom < 1 || zoom > 4) return null;
    result[path] = { x, y, zoom };
    for (const key of ["aspectRatio", "originalAspectRatio"] as const) {
      const ratio = (raw as MomentImageCrop)[key];
      if (ratio === undefined || ratio === null) continue;
      if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0.05 || ratio > 20) return null;
      result[path][key] = ratio;
    }
  }
  return result;
}

export function momentImageFrameStyle(crop?: MomentImageCrop, single = false) {
  const ratio = crop?.aspectRatio ?? (single ? crop?.originalAspectRatio : undefined);
  return ratio ? { aspectRatio: String(ratio) } : undefined;
}

export function parseMomentImageCrops(raw: string | undefined, images: string[]): MomentImageCrops {
  try { return normalizeMomentImageCrops(JSON.parse(raw ?? "{}"), images) ?? {}; }
  catch { return {}; }
}

export function momentImageCropStyle(crop?: MomentImageCrop) {
  if (!crop) return undefined;
  const position = `${crop.x * 100}% ${crop.y * 100}%`;
  return { objectPosition: position, transformOrigin: position, transform: `scale(${crop.zoom})` };
}
