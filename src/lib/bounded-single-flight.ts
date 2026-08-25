export type BoundedSingleFlightOptions = {
  timeoutMs: number;
  failureCacheMs: number;
  maxConcurrent: number;
};

/** Coalesces identical expensive work and bounds distinct work globally. */
export class BoundedSingleFlight {
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #failures = new Map<string, number>();
  readonly options: BoundedSingleFlightOptions;
  #active = 0;

  constructor(options: BoundedSingleFlightOptions) {
    this.options = options;
  }

  async run<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const failedUntil = this.#failures.get(key) ?? 0;
    if (failedUntil > Date.now()) throw new Error("资源暂时不可用");
    const existing = this.#inFlight.get(key);
    if (existing) return existing as Promise<T>;
    if (this.#active >= this.options.maxConcurrent) throw new Error("服务繁忙");

    this.#active += 1;
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const promise = Promise.resolve().then(() => task(signal));
    this.#inFlight.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.#failures.set(key, Date.now() + this.options.failureCacheMs);
      throw error;
    } finally {
      this.#active -= 1;
      this.#inFlight.delete(key);
      for (const [failureKey, expiresAt] of this.#failures) {
        if (expiresAt <= Date.now()) this.#failures.delete(failureKey);
      }
    }
  }
}
