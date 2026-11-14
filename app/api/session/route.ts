import { NextRequest, NextResponse } from 'next/server'
import { apiErrorResponse, assertSameOrigin, connectWallet, connectBrowserWallet, getSession, SESSION_COOKIE } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req)
    return NextResponse.json(session ? { address: session.id, walletAddress: session.walletAddress, network: session.network } : { address: null, walletAddress: null, network: null })
  } catch (error) { return apiErrorResponse(error) }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body?.mode === 'browser-wallet') return connectBrowserWallet(req, body.walletAddress)
    return await connectWallet(req, body.challengeToken, body.signature)
  } catch (error) { return apiErrorResponse(error) }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req)
    const response = NextResponse.json({ address: null, walletAddress: null, network: null })
    response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
    return response
  } catch (error) { return apiErrorResponse(error) }
}
