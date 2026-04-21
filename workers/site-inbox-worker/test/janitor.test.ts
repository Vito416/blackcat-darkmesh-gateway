import { describe, it, expect } from 'vitest'
import mod from '../src/index'

type KV = {
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
  list: (opts?: { prefix?: string }) => Promise<{ keys: { name: string }[] }>
}

function makeKv(): KV {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.has(key) ? map.get(key)! : null
    },
    async put(key, value) {
      map.set(key, value)
    },
    async delete(key) {
      map.delete(key)
    },
    async list(opts) {
      const prefix = opts?.prefix || ''
      const keys = []
      for (const k of map.keys()) {
        if (k.startsWith(prefix)) keys.push({ name: k })
      }
      return { keys }
    },
  }
}

describe('janitor expires items', () => {
  it('deletes expired envelopes on scheduled', async () => {
    const kv = makeKv()
    const now = Math.floor(Date.now() / 1000)
    await kv.put('jan:x1', JSON.stringify({ payload: 'p', exp: now - 10 }))
    await kv.put('replay:jan:x2', JSON.stringify({ payload: 'p', exp: now - 5 }))

    const env: any = { TEST_IN_MEMORY_KV: 0, INBOX_KV: kv }
    const ctx: any = { waitUntil: async (p: Promise<any>) => p }

    await mod.scheduled({ cron: '' } as any, env, ctx)

    const v1 = await kv.get('jan:x1')
    const v2 = await kv.get('replay:jan:x2')
    expect(v1).toBeNull()
    expect(v2).toBeNull()
  })
})
