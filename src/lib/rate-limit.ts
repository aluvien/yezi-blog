type SlidingWindowOptions = {
  windowMs: number;
  maxRequests: number;
  maxKeys?: number;
};

/** Small in-process guard with bounded memory; durable abuse controls still belong at the reverse proxy. */
export function createSlidingWindowLimiter({ windowMs, maxRequests, maxKeys = 5_000 }: SlidingWindowOptions) {
  const hits = new Map<string, number[]>();
  let checks = 0;

  return (key: string): boolean => {
    const now = Date.now();
    const cutoff = now - windowMs;
    checks += 1;
    if (checks % 128 === 0) {
      for (const [entryKey, timestamps] of hits) {
        if (timestamps[timestamps.length - 1] <= cutoff) hits.delete(entryKey);
      }
    }

    const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= maxRequests) {
      hits.delete(key);
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return true;
  };
}
