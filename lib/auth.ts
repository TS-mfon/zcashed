import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getMongoDatabase } from './mongodb'
import { parseSigningAddress, verifyZcashMessage } from './zcash-auth'
import { parseShieldedAddress } from './zcash'
import { ZingoError } from './zingo'

export const SESSION_COOKIE = 'zcashed_session'
const SESSION_SECONDS = 8 * 60 * 60
const CHALLENGE_SECONDS = 5 * 60
type Network = 'mainnet' | 'testnet'
type Session = { v: 1; kind: 'session'; id: string; walletAddress: string; network: Network; exp: number }
type Challenge = { v: 1; kind: 'challenge'; walletAddress: string; unifiedAddress?: string; network: Network; origin: string; nonce: string; message: string; exp: number }
let consumed = new Map<string, number>()
let limits = new Map<string, { count: number; until: number }>()

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError' }
}

function secret(): string {
  const configured = process.env.SESSION_SECRET
  if (configured) {
    if (configured.length < 32) throw new ApiError(503, 'SESSION_SECRET must contain at least 32 characters.')
    return configured
  }
  if (process.env.NODE_ENV === 'production') throw new ApiError(503, 'Wallet authentication is not configured.')
  const dir = process.env.ZCASHED_DATA_DIR || path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '.session-secret')
  if (!fs.existsSync(file)) {
    try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return fs.readFileSync(file, 'utf8').trim()
}

function sign(payload: Session | Challenge): string {
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return text + '.' + createHmac('sha256', secret()).update(text).digest('base64url')
}

function readToken(token: string | undefined): Session | Challenge | null {
  if (!token || token.length > 8192) return null
  const parts = token.split('.')
  if (parts.length !== 2 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null
  const expected = createHmac('sha256', secret()).update(parts[0]).digest()
  const actual = Buffer.from(parts[1], 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (data.v !== 1 || !Number.isSafeInteger(data.exp) || data.exp <= Date.now() || typeof data.walletAddress !== 'string') return null
    if (data.network !== 'testnet') return null
    if (data.kind === 'session' && /^user_[a-f0-9]{64}$/.test(data.id)) return data
    if (data.kind === 'challenge' && typeof data.message === 'string' && typeof data.origin === 'string' && /^[a-f0-9]{32}$/.test(data.nonce)) return data
    return null
  } catch { return null }
}

export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin')
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'Open ZCashed directly to continue.')
  }
}

function rateLimit(key: string, max = 60): void {
  const now = Date.now()
  const previous = limits.get(key)
  const entry = previous && previous.until > now ? previous : { count: 0, until: now + 60_000 }
  if (entry.count >= max) throw new ApiError(429, 'Too many requests. Try again in a minute.')
  limits = new Map([...limits].filter(([, value]) => value.until > now))
  limits.set(key, { ...entry, count: entry.count + 1 })
}

export function getSession(req: NextRequest): Session | null {
  const token = readToken(req.cookies.get(SESSION_COOKIE)?.value)
  return token?.kind === 'session' ? token : null
}

export function requireActor(req: NextRequest, claimed?: unknown): string {
  if (req.method !== 'GET') assertSameOrigin(req)
  const session = getSession(req)
  if (!session) throw new ApiError(401, 'Connect your existing wallet before continuing.')
  if (claimed !== undefined && claimed !== session.id) throw new ApiError(403, 'This action belongs to a different account.')
  rateLimit(session.id)
  return session.id
}

export function createWalletChallenge(req: NextRequest, address: unknown, unifiedAddress?: unknown): { message: string; challengeToken: string; expiresAt: string } {
  assertSameOrigin(req)
  rateLimit('challenge:' + (req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'), 20)
  if (typeof address !== 'string' || address.length > 128) throw new ApiError(400, 'Enter an existing Zcash signing address.')
  let wallet: ReturnType<typeof parseSigningAddress>
  try { wallet = parseSigningAddress(address.trim()) }
  catch { throw new ApiError(400, 'Use an existing Zcash transparent P2PKH address for message signing. Payouts use a separate shielded address.') }
  if (wallet.network !== 'testnet') throw new ApiError(400, 'ZCashed supports Zcash testnet only.')
  let unified: string | undefined
  if (unifiedAddress !== undefined) {
    if (typeof unifiedAddress !== 'string') throw new ApiError(400, 'The wallet returned an invalid testnet account.')
    try { unified = parseShieldedAddress(unifiedAddress, 'testnet').address }
    catch { throw new ApiError(400, 'Connect a valid testnet Unified Address from your wallet.') }
    if (!unified.startsWith('utest1')) throw new ApiError(400, 'Connect a testnet Unified Address.')
  }
  const exp = Date.now() + CHALLENGE_SECONDS * 1000
  const nonce = randomBytes(16).toString('hex')
  const message = ['Connect your existing wallet to ZCashed', 'Domain: ' + req.nextUrl.host, 'Wallet: ' + wallet.address,
    'Network: Zcash ' + wallet.network, 'Nonce: ' + nonce, 'Expires: ' + new Date(exp).toISOString(),
    ...(unified ? ['Testnet account: ' + unified] : []),
    'This signature connects your account. It does not authorize a payment.'].join('\n')
  return { message, challengeToken: sign({ v: 1, kind: 'challenge', ...wallet, ...(unified ? { unifiedAddress: unified } : {}), walletAddress: wallet.address, origin: req.nextUrl.origin, nonce, message, exp }), expiresAt: new Date(exp).toISOString() }
}

async function consumeNonce(nonce: string, exp: number): Promise<void> {
  const db = await getMongoDatabase()
  if (db) {
    try { await db.collection('auth_nonces').insertOne({ _id: nonce as never, expiresAt: new Date(exp) }) }
    catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ApiError(409, 'This challenge was already used. Request a new one.')
      throw new ApiError(503, 'Wallet authentication storage is unavailable. Try again.')
    }
    return
  }
  const now = Date.now()
  consumed = new Map([...consumed].filter(([, expires]) => expires > now))
  if (consumed.has(nonce)) throw new ApiError(409, 'This challenge was already used. Request a new one.')
  consumed = new Map([...consumed, [nonce, exp]])
}

export async function connectWallet(req: NextRequest, challengeToken: unknown, signature: unknown): Promise<NextResponse> {
  assertSameOrigin(req)
  if (typeof challengeToken !== 'string' || typeof signature !== 'string') throw new ApiError(400, 'Sign the connection challenge in your existing wallet.')
  rateLimit('verify:' + (req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'), 20)
  const challenge = readToken(challengeToken)
  if (challenge?.kind !== 'challenge' || challenge.origin !== req.nextUrl.origin) throw new ApiError(401, 'The connection challenge expired or changed. Request a new one.')
  if (!verifyZcashMessage(challenge.walletAddress, challenge.message, signature.trim())) throw new ApiError(401, 'The signature does not match this wallet and challenge.')
  await consumeNonce(challenge.nonce, challenge.exp)
  const id = 'user_' + createHmac('sha256', secret()).update('wallet:' + challenge.walletAddress).digest('hex')
  const payload: Session = { v: 1, kind: 'session', id, walletAddress: challenge.unifiedAddress ?? challenge.walletAddress, network: challenge.network, exp: Date.now() + SESSION_SECONDS * 1000 }
  const response = NextResponse.json({ address: id, walletAddress: payload.walletAddress, network: payload.network })
  response.cookies.set(SESSION_COOKIE, sign(payload), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS })
  return response
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZingoError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Send a valid JSON request.' }, { status: 400 })
  console.error('ZCashed API failure:', error instanceof Error ? error.name : 'unknown error')
  return NextResponse.json({ error: 'The service is unavailable. Try again shortly.' }, { status: 500 })
}
