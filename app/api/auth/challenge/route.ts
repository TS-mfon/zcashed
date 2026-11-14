import { NextRequest, NextResponse } from 'next/server'
import { apiErrorResponse, createWalletChallenge } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    return NextResponse.json(createWalletChallenge(req, body.walletAddress, body.unifiedAddress))
  }
  catch (error) { return apiErrorResponse(error) }
}
