import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

type Schema = {
  type?: string | string[]
  const?: Json
  enum?: Json[]
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: Schema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
}

function schemaDir() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../ops/migrations/schemas')
}

function loadSchema(name: string): Schema {
  const file = resolve(schemaDir(), name)
  return JSON.parse(readFileSync(file, 'utf8')) as Schema
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesType(type: string, value: unknown): boolean {
  if (type === 'string') return typeof value === 'string'
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isObject(value)
  if (type === 'null') return value === null
  return true
}

function validateSubset(schema: Schema, value: unknown, path = '$'): string[] {
  const errors: string[] = []

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: const mismatch`)
    return errors
  }

  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push(`${path}: enum mismatch`)
    return errors
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!allowedTypes.some((t) => matchesType(t, value))) {
      errors.push(`${path}: type mismatch`)
      return errors
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: below minLength`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: above maxLength`)
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern)
      if (!re.test(value)) {
        errors.push(`${path}: pattern mismatch`)
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: below minimum`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: above maximum`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: below minItems`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: above maxItems`)
    }
    if (schema.uniqueItems) {
      const seen = new Set<string>()
      for (const item of value) {
        const key = JSON.stringify(item)
        if (seen.has(key)) {
          errors.push(`${path}: duplicate array item`)
          break
        }
        seen.add(key)
      }
    }
    if (schema.items) {
      value.forEach((item, idx) => {
        errors.push(...validateSubset(schema.items as Schema, item, `${path}[${idx}]`))
      })
    }
  }

  if (isObject(value)) {
    const props = schema.properties ?? {}
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${path}.${key}: required missing`)
        }
      }
    }

    for (const [key, child] of Object.entries(props)) {
      if (key in value) {
        errors.push(...validateSubset(child, value[key], `${path}.${key}`))
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          errors.push(`${path}.${key}: additional property not allowed`)
        }
      }
    }
  }

  return errors
}

describe('DM1 schema harness (subset validator)', () => {
  const txtSchema = loadSchema('dm1-dns-txt.schema.json')
  const cfgSchema = loadSchema('dm1-config.schema.json')
  const routeSchema = loadSchema('dm1-route-assertion.schema.json')

  it('accepts representative valid DM1 TXT envelope', () => {
    const payload = {
      v: 'dm1',
      cfg: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
      kid: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
      ttl: 3600
    }
    expect(validateSubset(txtSchema, payload)).toEqual([])
  })

  it('rejects representative invalid DM1 TXT envelope', () => {
    const payload = {
      v: 'dm1',
      cfg: 'short',
      kid: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
      ttl: 30
    }
    const errors = validateSubset(txtSchema, payload)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts representative valid DM1 config payload', () => {
    const payload = {
      v: 'dm1',
      domain: 'example.com',
      siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
      writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
      entryPath: '/',
      validFrom: 1760000000,
      validTo: 1790000000,
      sigAlg: 'rsa-pss-sha256',
      sig: 'a'.repeat(64)
    }
    expect(validateSubset(cfgSchema, payload)).toEqual([])
  })

  it('rejects representative invalid DM1 config payload', () => {
    const payload = {
      v: 'dm1',
      domain: 'example.com',
      siteProcess: 'AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890ABC',
      writeProcess: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321XYZ',
      entryPath: '/',
      validFrom: 1760000000,
      validTo: 1790000000,
      sigAlg: 'ed25519',
      sig: '!!!tampered!!!'
    }
    const errors = validateSubset(cfgSchema, payload)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts representative valid route assertion envelope', () => {
    const payload = {
      ok: true,
      assertion: {
        v: 'dm-route-assert/1',
        iat: 1760000000,
        exp: 1760000060,
        challengeNonce: 'nonce.12345678',
        challengeExp: 1760000120,
        domain: 'demo.darkmesh.fun',
        cfgTx: 'Qz8d64GWY7L30I3e6ynXC49gv6G8pcO6lJG2Yr-km6w',
        hbHost: 'hyperbeam.darkmesh.fun',
        siteProcess: 'site-process-placeholder',
        writeProcess: 'write-process-placeholder',
        entryPath: '/'
      },
      signature: 'a'.repeat(128),
      sigAlg: 'ed25519',
      signatureRef: 'worker-ed25519-site'
    }
    expect(validateSubset(routeSchema, payload)).toEqual([])
  })

  it('rejects representative invalid route assertion envelope', () => {
    const payload = {
      ok: false,
      assertion: {
        v: 'dm-route-assert/1',
        iat: 1760000000,
        exp: 1760000060,
        challengeNonce: 'bad nonce with spaces',
        challengeExp: 1760000120,
        domain: 'demo.darkmesh.fun',
        cfgTx: 'Qz8d64GWY7L30I3e6ynXC49gv6G8pcO6lJG2Yr-km6w',
        hbHost: 'hyperbeam.darkmesh.fun'
      },
      signature: 'xyz',
      sigAlg: 'ed25519',
      signatureRef: 'worker-ed25519-site'
    }
    const errors = validateSubset(routeSchema, payload)
    expect(errors.length).toBeGreaterThan(0)
  })
})
