import { describe, expect, it } from 'vitest'

import {
  normalizeSignatureRefList,
  signatureRefListsOverlap,
  validateExpectedSignatureRefs,
  validateSignatureRefList,
} from '../src/runtime/crypto/signatureRefs.js'

describe('runtime crypto signatureRef helpers', () => {
  it('normalizes signature ref lists by trimming and deduplicating', () => {
    expect(
      normalizeSignatureRefList([' sig-root ', 'sig-upgrade', 'sig-root', 'sig-emergency ', ' sig-upgrade ']),
    ).toEqual(['sig-root', 'sig-upgrade', 'sig-emergency'])
  })

  it('rejects empty and invalid signature ref lists', () => {
    expect(validateSignatureRefList([])).toEqual({
      ok: false,
      error: 'signatureRef list must not be empty',
    })
    expect(validateSignatureRefList(['sig-root', '   '])).toEqual({
      ok: false,
      error: 'signatureRef[1] must not be empty',
    })
    expect(validateSignatureRefList(['sig-root', 42])).toEqual({
      ok: false,
      error: 'signatureRef list must be an array of strings',
    })
    expect(validateSignatureRefList('sig-root')).toEqual({
      ok: false,
      error: 'signatureRef list must be an array of strings',
    })
  })

  it('matches expected refs only when the sets overlap', () => {
    expect(
      validateExpectedSignatureRefs(['sig-root', 'sig-upgrade'], ['sig-upgrade', 'sig-emergency']),
    ).toEqual({
      ok: true,
      matchedRefs: ['sig-upgrade'],
    })

    expect(validateExpectedSignatureRefs(['sig-root'], ['sig-upgrade'])).toEqual({
      ok: false,
      error: 'signatureRef lists do not overlap',
    })
  })

  it('enforces strict set equality when requested', () => {
    expect(
      validateExpectedSignatureRefs(['sig-upgrade', 'sig-root'], ['sig-root', 'sig-upgrade'], {
        strict: true,
      }),
    ).toEqual({
      ok: true,
      matchedRefs: ['sig-upgrade', 'sig-root'],
    })

    expect(validateExpectedSignatureRefs(['sig-root'], ['sig-root', 'sig-upgrade'], { strict: true })).toEqual({
      ok: false,
      error: 'signatureRef lists must match exactly',
    })
  })

  it('reports overlap for rotation windows', () => {
    expect(signatureRefListsOverlap(['sig-old', 'sig-new'], ['sig-new', 'sig-next'])).toBe(true)
    expect(signatureRefListsOverlap(['sig-old'], ['sig-new'])).toBe(false)
  })
})
