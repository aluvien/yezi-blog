import crypto from "node:crypto";
import { BoundedSingleFlight } from "@/lib/bounded-single-flight";

/** Keep multipart buffers and sharp decodes bounded per Node process. */
export const MAX_CONCURRENT_UPLOADS = 2;

const uploadProcessing = new BoundedSingleFlight({
  timeoutMs: 5 * 60 * 1000,
  failureCacheMs: 0,
  maxConcurrent: MAX_CONCURRENT_UPLOADS,
});

export function withUploadProcessingLimit<T>(task: () => Promise<T>): Promise<T> {
  return uploadProcessing.run(crypto.randomUUID(), () => task());
}
