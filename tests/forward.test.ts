import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'

import { handleRequest } from '../src/handler'

let server: http.Server
let receivedBody = ''
let receivedSig: string | undefined

beforeAll((done) => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks).toString()
      receivedSig = req.headers['x-signature'] as string | undefined
      res.statusCode = 202
      res.end('ok')
    })
  })
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

describe('demo forward webhook -> worker notify', () => {
  it('forwards body with bearer and HMAC', async () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    process.env.WORKER_NOTIFY_URL = `http://127.0.0.1:${port}/notify`
    process.env.WORKER_NOTIFY_TOKEN = 't-notify'
    process.env.WORKER_NOTIFY_HMAC = 'secret-hmac'
    const body = JSON.stringify({ webhookUrl: 'https://example.com/hook', data: { x: 1 } })
    const req = new Request('http://gateway/webhook/demo-forward', { method: 'POST', body })
    const res = await handleRequest(req)
    expect(res.status).toBe(200)
    expect(receivedBody).toBe(body)
    expect(receivedSig).toBeTruthy()
  })
})
