export const POSTS_PAGE_SIZE = 12;

export function parsePostPage(value?: string | string[]): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && Number.isSafeInteger((page - 1) * POSTS_PAGE_SIZE) ? page : 1;
}
