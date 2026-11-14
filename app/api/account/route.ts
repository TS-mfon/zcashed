import { NextRequest } from 'next/server'
import { accountSessionResponse, apiErrorResponse, ApiError, requireActor } from '@/lib/auth'
import { canonicalUsername, limitAccountAttempt, loginAccount, registerAccount } from '@/lib/accounts'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const actor = requireActor(req, undefined, true)
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Supply your username and password.')
    const fields = body as Record<string, unknown>
    if (Object.keys(fields).some(key => !['mode', 'username', 'password'].includes(key)) || !['register', 'login'].includes(String(fields.mode))) throw new ApiError(400, 'Choose account registration or sign-in.')
    const username = canonicalUsername(fields.username)
    await limitAccountAttempt(req, username)
    const account = fields.mode === 'register' ? await registerAccount(actor, username, fields.password) : await loginAccount(username, fields.password)
    return accountSessionResponse(req, account)
  } catch (error) { return apiErrorResponse(error) }
}
