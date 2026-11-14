import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sign } from 'bitcoinjs-message'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { getPublicKey } from '@noble/secp256k1'
import bs58check from 'bs58check'
import { POST as challenge } from '../app/api/auth/challenge/route'
import { POST as connect, GET as session, DELETE as disconnect } from '../app/api/session/route'
import { requireActor } from '../lib/auth'
import { verifyZcashMessage } from '../lib/zcash-auth'

// Public, unfunded test fixture. bitcoinjs-message is an independent signer.
const key = Buffer.alloc(32, 0x31)
const address = bs58check.encode(Buffer.concat([Buffer.from([0x1d, 0x25]), Buffer.from(ripemd160(sha256(getPublicKey(key))))]))
const origin = 'http://localhost:3000'
function request(path: string, body?: unknown, cookie?: string) {
  return new NextRequest(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
function signature(message: string) {
  return sign(message, key, true, '\x16Zcash Signed Message:\n').toString('base64')
}

describe('connect an existing Zcash wallet', () => {
  beforeEach(() => { vi.useRealTimers(); vi.stubEnv('NODE_ENV', 'test') })

  it('verifies standard Zcash compact signatures, including Unicode and long messages', () => {
    for (const text of ['ZCashed connection', 'Private work ₦ — '.repeat(30)]) {
      expect(verifyZcashMessage(address, text, signature(text))).toBe(true)
      expect(verifyZcashMessage(address, text + ' changed', signature(text))).toBe(false)
    }
    expect(verifyZcashMessage(address, 'ZCashed connection', 'not-a-signature')).toBe(false)
  })

  it('requires a valid wallet signature and returns an opaque app identity without keys', async () => {
    const ch = await challenge(request('/api/auth/challenge', { walletAddress: address }))
    expect(ch.status).toBe(200)
    const proof = await ch.json()
    const response = await connect(request('/api/session', { challengeToken: proof.challengeToken, signature: signature(proof.message) }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.address).toMatch(/^user_[a-f0-9]{64}$/)
    expect(data.walletAddress).toBe(address)
    expect(data).not.toHaveProperty('privateKeyHex')
    const cookie = response.headers.get('set-cookie')!.split(';')[0]
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(requireActor(request('/api/jobs', { title: 'work' }, cookie), data.address)).toBe(data.address)
    expect(() => requireActor(request('/api/jobs', {}, cookie), 'someone-else')).toThrow()
    expect((await (await session(request('/api/session', undefined, cookie))).json()).address).toBe(data.address)
    expect((await connect(request('/api/session', { challengeToken: proof.challengeToken, signature: signature(proof.message) }))).status).toBe(409)
  })

  it('rejects unsigned addresses and invalid signatures without creating sessions', async () => {
    expect((await connect(request('/api/session', { walletAddress: address }))).status).toBe(400)
    const ch = await (await challenge(request('/api/auth/challenge', { walletAddress: address }))).json()
    expect((await connect(request('/api/session', { challengeToken: ch.challengeToken, signature: signature('wrong message') }))).status).toBe(401)
    expect((await session(request('/api/session'))).status).toBe(200)
    expect((await (await session(request('/api/session'))).json()).address).toBeNull()
  })

  it('rejects tampered, expired and cross-site challenges', async () => {
    const ch = await (await challenge(request('/api/auth/challenge', { walletAddress: address }))).json()
    expect((await connect(request('/api/session', { challengeToken: ch.challengeToken + 'x', signature: signature(ch.message) }))).status).toBe(401)
    const cross = new NextRequest(origin + '/api/auth/challenge', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ walletAddress: address }) })
    expect((await challenge(cross)).status).toBe(403)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 6 * 60 * 1000)
    expect((await connect(request('/api/session', { challengeToken: ch.challengeToken, signature: signature(ch.message) }))).status).toBe(401)
    vi.useRealTimers()
  })

  it('rejects a malformed address and clears the wallet session on disconnect', async () => {
    expect((await challenge(request('/api/auth/challenge', { walletAddress: 'tm-not-valid' }))).status).toBe(400)
    const response = await disconnect(new NextRequest(origin + '/api/session', { method: 'DELETE', headers: { Origin: origin } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
