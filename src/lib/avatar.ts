/**
 * 生成无需网络请求的稳定随机头像。
 *
 * 相同 seed 始终得到同一张 SVG，既避免“匿名用户没有头像”，也不把昵称、
 * 邮箱或访问记录发送给第三方头像服务。
 */
export function generatedAvatar(seed: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const value = hash >>> 0;
  const hue = value % 360;
  const accentHue = (hue + 32 + ((value >>> 9) % 64)) % 360;
  const circleX = 20 + ((value >>> 5) % 34);
  const circleY = 18 + ((value >>> 11) % 30);
  const circleRadius = 13 + ((value >>> 17) % 12);
  const tilt = ((value >>> 23) % 32) - 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="随机头像"><rect width="72" height="72" rx="14" fill="hsl(${hue} 42% 91%)"/><circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="hsl(${accentHue} 52% 62%)" opacity=".9"/><path d="M-8 59C11 ${42 + tilt} 31 ${72 - tilt} 80 49V80H-8Z" fill="hsl(${hue} 38% 74%)"/><circle cx="53" cy="51" r="7" fill="hsl(${accentHue} 48% 96%)" opacity=".72"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
