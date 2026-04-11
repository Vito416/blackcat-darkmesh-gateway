export type ReplayStoreOptions = {
  ttlMs: number
  maxKeys: number
  sweepIntervalMs: number
  keyMaxBytes: number
  now?: () => number
}

export type ReplayStoreMarkResult = {
  replay: boolean
  rejected: boolean
  pruned: number
  size: number
}

export class ReplayStore {
  private readonly seen = new Map<string, number>()
  private readonly encoder = new TextEncoder()
  private readonly nowFn: () => number
  private lastSweepAt = 0

  constructor(private readonly options: ReplayStoreOptions) {
    this.nowFn = options.now || Date.now
  }

  get size(): number {
    return this.seen.size
  }

  sweep(now = this.nowFn()): number {
    this.lastSweepAt = now
    return this.sweepExpired(now)
  }

  markAndCheck(key: string): ReplayStoreMarkResult {
    const now = this.nowFn()

    if (this.byteLength(key) > this.options.keyMaxBytes) {
      return { replay: true, rejected: true, pruned: 0, size: this.size }
    }

    let pruned = this.maybeSweep(now)
    const prev = this.seen.get(key)

    if (prev !== undefined) {
      if (prev > now) {
        this.seen.set(key, now + this.options.ttlMs)
        return { replay: true, rejected: false, pruned, size: this.size }
      }

      this.seen.delete(key)
    }

    pruned += this.pruneToCapacity()
    this.seen.set(key, now + this.options.ttlMs)

    return { replay: false, rejected: false, pruned, size: this.size }
  }

  private byteLength(value: string): number {
    return this.encoder.encode(value).byteLength
  }

  private maybeSweep(now: number): number {
    if (this.seen.size >= this.options.maxKeys) {
      return this.sweep(now)
    }

    if (now - this.lastSweepAt < this.options.sweepIntervalMs) {
      return 0
    }

    return this.sweep(now)
  }

  private sweepExpired(now: number): number {
    let removed = 0
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) {
        this.seen.delete(key)
        removed++
      }
    }
    return removed
  }

  private pruneToCapacity(): number {
    let removed = 0

    while (this.seen.size >= this.options.maxKeys) {
      const oldest = this.seen.keys().next().value
      if (oldest === undefined) break
      this.seen.delete(oldest)
      removed++
    }

    return removed
  }
}
