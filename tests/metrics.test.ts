import { describe, it, expect, beforeEach } from 'vitest'
import { inc, gauge, toProm, reset } from '../src/metrics.js'

beforeEach(() => {
  reset()
})

describe('metrics exporter', () => {
  it('emits counters with _total suffix and HELP/TYPE', () => {
    inc('gateway_cache_hit')
    const prom = toProm()
    expect(prom).toContain('# HELP gateway_cache_hit_total Cache hits')
    expect(prom).toContain('# TYPE gateway_cache_hit_total counter')
    expect(prom).toMatch(/gateway_cache_hit_total 1/)
  })

  it('emits gauges with HELP/TYPE', () => {
    gauge('gateway_cache_size', 3)
    const prom = toProm()
    expect(prom).toContain('# HELP gateway_cache_size Cache entries currently stored')
    expect(prom).toContain('# TYPE gateway_cache_size gauge')
    expect(prom).toMatch(/gateway_cache_size 3/)
  })
})
