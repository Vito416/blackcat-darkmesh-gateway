import { describe, expect, it } from 'vitest'
import { applyProbeOutcome, applyRefreshOutcome, computeNextRefreshAt, computeRefreshSchedulingHint } from '../src/domainStateMachine.js'

const HOST = 'Example.COM'

describe('domain state transitions', () => {
  it('valid -> stale on refresh failure inside stale-if-error grace window', () => {
    const valid = applyRefreshOutcome(
      null,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_123',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 2_000
      },
      HOST,
      1_000,
      { staleIfErrorMs: 5_000, minTtlMs: 1 }
    )

    const stale = applyRefreshOutcome(
      valid,
      { kind: 'refresh_failure', error: { code: 'dns_timeout', message: 'dns timeout', at: 4_000 } },
      HOST,
      4_000,
      { staleIfErrorMs: 5_000, minTtlMs: 1 }
    )

    expect(stale.status).toBe('stale')
    expect(stale.lastErrorCode).toBe('dns_timeout')
    expect(stale.lastErrorAt).toBe(4_000)
    expect(stale.refreshAttempts).toBe(1)
  })

  it('stale -> invalid once hard expiry passed', () => {
    const valid = applyRefreshOutcome(
      null,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_123',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 1_000
      },
      HOST,
      1_000,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )

    const stale = applyRefreshOutcome(
      valid,
      { kind: 'refresh_failure', error: 'dns_timeout' },
      HOST,
      2_500,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )
    const invalid = applyRefreshOutcome(
      stale,
      { kind: 'refresh_failure', error: 'dns_timeout' },
      HOST,
      4_500,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )

    expect(stale.status).toBe('stale')
    expect(invalid.status).toBe('invalid')
    expect(invalid.refreshAttempts).toBe(2)
  })

  it('invalid -> valid recovers on next successful refresh', () => {
    const invalid = applyRefreshOutcome(
      null,
      { kind: 'refresh_failure', error: 'dns_timeout' },
      HOST,
      1_000,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )

    const recovered = applyRefreshOutcome(
      invalid,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_recovered',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 4_000
      },
      HOST,
      2_000,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )

    expect(invalid.status).toBe('invalid')
    expect(recovered.status).toBe('valid')
    expect(recovered.cfgTx).toBe('tx_recovered')
    expect(recovered.lastSuccessAt).toBe(2_000)
    expect(recovered.lastErrorCode).toBeNull()
    expect(recovered.refreshAttempts).toBe(0)
  })

  it('probe failures preserve stale-if-error policy for cached entries', () => {
    const valid = applyRefreshOutcome(
      null,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_123',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 2_000
      },
      HOST,
      1_000,
      { staleIfErrorMs: 5_000, minTtlMs: 1 }
    )

    const probeFail = applyProbeOutcome(valid, { kind: 'probe_failure', error: 'hb_404' }, HOST, 1_500)
    expect(probeFail.status).toBe('stale')
    expect(probeFail.lastErrorCode).toBe('error')
    expect(probeFail.lastErrorAt).toBe(1_500)
  })
})

describe('domain refresh scheduling hints', () => {
  it('returns immediate refresh for empty cache', () => {
    const nextAt = computeNextRefreshAt(null, 10_000)
    expect(nextAt).toBe(10_000)
  })

  it('computes deterministic jitter-safe hint for valid entries', () => {
    const valid = applyRefreshOutcome(
      null,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_123',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 20_000
      },
      HOST,
      1_000,
      { staleIfErrorMs: 5_000, minTtlMs: 1 }
    )

    const hintA = computeRefreshSchedulingHint(valid, 'example.com', 2_000, {
      validLeadMs: 5_000,
      jitterRatio: 0.2
    })
    const hintB = computeRefreshSchedulingHint(valid, 'example.com', 2_000, {
      validLeadMs: 5_000,
      jitterRatio: 0.2
    })

    expect(hintA.reason).toBe('valid_refresh')
    expect(hintA.baseRefreshAt).toBe(16_000)
    expect(hintA.nextRefreshAt).toBe(hintB.nextRefreshAt)
    expect(hintA.nextRefreshAt).toBeGreaterThanOrEqual(2_000)
  })

  it('schedules stale retry before hard expiry', () => {
    const valid = applyRefreshOutcome(
      null,
      {
        kind: 'refresh_success',
        cfgTx: 'tx_123',
        resolvedTarget: '~process@1.0/http',
        ttlMs: 1_000
      },
      HOST,
      1_000,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )
    const stale = applyRefreshOutcome(
      valid,
      { kind: 'refresh_failure', error: 'dns_timeout' },
      HOST,
      1_900,
      { staleIfErrorMs: 2_000, minTtlMs: 1 }
    )

    const hint = computeRefreshSchedulingHint(stale, 'example.com', 2_800, {
      staleRetryMs: 2_000,
      jitterRatio: 0
    })
    expect(hint.reason).toBe('stale_retry')
    expect(hint.baseRefreshAt).toBe(4_000)
  })
})
