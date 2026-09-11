/** Scoped, in-flight-only coordination; mutations may request one trailing refresh. */
export class SliceRequests {
  private pending = new Map<string, { promise: Promise<void>; trailing?: Promise<void> }>();
  private loaded = new Set<string>();
  private epoch = 0;

  clear() {
    this.epoch += 1;
    this.pending.clear();
    this.loaded.clear();
  }

  load(key: string, loader: () => Promise<void>, refresh = false): Promise<void> {
    const entry = this.pending.get(key);
    if (entry) {
      if (!refresh || entry.trailing) return entry.trailing || entry.promise;
      const epoch = this.epoch;
      entry.trailing = entry.promise.catch(() => {}).then(() => {
        if (epoch === this.epoch) return this.start(key, loader);
      });
      return entry.trailing;
    }
    if (!refresh && this.loaded.has(key)) return Promise.resolve();
    return this.start(key, loader);
  }

  private start(key: string, loader: () => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    const entry = { promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(loader).then(() => {
      if (epoch === this.epoch) this.loaded.add(key);
    }, error => {
      if (epoch === this.epoch) this.loaded.delete(key);
      throw error;
    }).finally(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
    });
    this.pending.set(key, entry);
    return entry.promise;
  }
}
