import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiError } from './auth'
import { getMongoDatabase } from './mongodb'

type Account = { _id: string; actorId: string; salt: string; passwordHash: string; createdAt: string }
type AttemptLimit = { _id: string; count: number; expiresAt: Date }
const USERNAME = /^[a-z0-9_]{3,24}$/
const ACTOR = /^user_[a-f0-9]{64}$/
const WINDOW_MS = 10 * 60 * 1000

export function canonicalUsername(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Choose a username.')
  const username = value.trim().toLowerCase()
  if (!USERNAME.test(username)) throw new ApiError(400, 'Use 3–24 letters, numbers, or underscores for your username.')
  return username
}

function passwordValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new ApiError(400, 'Use a password with 8–128 characters.')
  return value
}

async function database() {
  const db = await getMongoDatabase()
  if (!db) throw new ApiError(503, 'Account storage is unavailable. Please try again.')
  return db
}

async function accounts() {
  const collection = (await database()).collection<Account>('accounts')
  await collection.createIndex({ actorId: 1 }, { unique: true })
  return collection
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(new ApiError(503, 'Account authentication is temporarily unavailable.'))
      else resolve(derived)
    })
  })
}

async function passwordMatches(account: Account | null, password: string): Promise<boolean> {
  // Unknown accounts use the same expensive derivation before a generic failure.
  const salt = account?.salt ?? '0000000000000000000000000000000000000000000000000000000000000000'
  const actual = await derivePassword(password, salt)
  const expected = Buffer.from(account?.passwordHash ?? '00'.repeat(64), 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected) && account !== null
}

export async function limitAccountAttempt(req: NextRequest, username: string): Promise<void> {
  const collection = (await database()).collection<AttemptLimit>('account_auth_limits')
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  const now = Date.now()
  const slot = Math.floor(now / WINDOW_MS)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  for (const [scope, maximum] of [[`ip:${ip}`, 30], [`username:${username}`, 12]] as const) {
    const id = createHash('sha256').update(scope + ':' + slot).digest('hex')
    let count: number
    try {
      const entry = await collection.findOneAndUpdate({ _id: id }, {
        $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((slot + 2) * WINDOW_MS) },
      }, { upsert: true, returnDocument: 'after' })
      count = entry?.count ?? maximum + 1
    } catch { throw new ApiError(503, 'Account authentication is temporarily unavailable.') }
    if (count > maximum) throw new ApiError(429, 'Too many account attempts. Try again in ten minutes.')
  }
}

export async function registerAccount(actorId: string, value: unknown, rawPassword: unknown): Promise<{ username: string; actorId: string }> {
  if (!ACTOR.test(actorId)) throw new ApiError(401, 'Connect your wallet before creating an account.')
  const username = canonicalUsername(value)
  const password = passwordValue(rawPassword)
  const collection = await accounts()
  const existing = await collection.findOne({ actorId })
  if (existing) {
    if (existing._id !== username) throw new ApiError(409, 'This account already has a username. Sign in to continue.')
    if (!await passwordMatches(existing, password)) throw new ApiError(401, 'The username or password is incorrect.')
    return { username, actorId }
  }
  const salt = randomBytes(32).toString('hex')
  const passwordHash = (await derivePassword(password, salt)).toString('hex')
  try {
    const result = await collection.insertOne({ _id: username, actorId, salt, passwordHash, createdAt: new Date().toISOString() }, { writeConcern: { w: 'majority', j: true } })
    if (!result.acknowledged) throw new Error('Account creation was not acknowledged')
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ApiError(409, 'That username is already taken, or this account already has a username.')
    throw new ApiError(503, 'The account could not be saved. Try signing in with the same username and password.')
  }
  return { username, actorId }
}

export async function loginAccount(value: unknown, rawPassword: unknown): Promise<{ username: string; actorId: string }> {
  const username = canonicalUsername(value)
  const password = passwordValue(rawPassword)
  const account = await (await accounts()).findOne({ _id: username })
  if (!await passwordMatches(account, password) || !account || !ACTOR.test(account.actorId)) throw new ApiError(401, 'The username or password is incorrect.')
  return { username, actorId: account.actorId }
}

export async function accountUsername(actorId: string): Promise<string | null> {
  const account = await (await accounts()).findOne({ actorId }, { projection: { _id: 1 } })
  return account?._id ?? null
}
