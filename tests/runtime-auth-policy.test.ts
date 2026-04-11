import { describe, expect, it } from 'vitest'
import {
  normalizePolicyValues,
  requireAllowedRole,
  requireAuthorizedSignatureRef,
} from '../src/runtime/auth/policy.js'

describe('runtime auth policy helpers', () => {
  it('normalizes policy values deterministically', () => {
    expect(normalizePolicyValues(['  root  ', 'root', '', 'upgrade'])).toEqual(['root', 'upgrade'])
    expect(normalizePolicyValues('  sig-current  ')).toEqual(['sig-current'])
  })

  it('allows required roles when the presented role matches after normalization', () => {
    expect(requireAllowedRole('Shop_Admin', ' shop_admin ')).toEqual({ ok: true })
    expect(requireAllowedRole(['viewer', 'editor'], 'EDITOR')).toEqual({ ok: true })
    expect(requireAllowedRole('public', undefined, { publicRole: 'public' })).toEqual({ ok: true })
  })

  it('denies required roles with a deterministic forbidden code', () => {
    expect(requireAllowedRole('shop_admin', 'viewer')).toEqual({
      ok: false,
      error: 'role_forbidden',
    })
    expect(requireAllowedRole(['root', 'upgrade'], undefined)).toEqual({
      ok: false,
      error: 'role_forbidden',
    })
  })

  it('allows active and rotation-overlap signature refs', () => {
    expect(requireAuthorizedSignatureRef('sig-current', ['sig-current'], ['sig-previous'])).toEqual({
      ok: true,
    })
    expect(requireAuthorizedSignatureRef('sig-previous', ['sig-current'], ['sig-previous'])).toEqual({
      ok: true,
    })
    expect(requireAuthorizedSignatureRef('sig-overlap', [], ['sig-overlap', 'sig-standby'])).toEqual({
      ok: true,
    })
  })

  it('denies unauthorized signature refs with a deterministic forbidden code', () => {
    expect(requireAuthorizedSignatureRef('sig-other', ['sig-current'], ['sig-previous'])).toEqual({
      ok: false,
      error: 'signature_ref_forbidden',
    })
    expect(requireAuthorizedSignatureRef('', ['sig-current'], ['sig-previous'])).toEqual({
      ok: false,
      error: 'signature_ref_forbidden',
    })
  })
})
