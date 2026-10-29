export type MomentPlacement = "top" | "bottom";

export function validMomentPlacement(value: unknown): value is MomentPlacement | null | undefined {
  return value === undefined || value === null || value === "top" || value === "bottom";
}
