import { NextRequest, NextResponse } from 'next/server'
import { apiErrorResponse, createWalletChallenge } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try { return NextResponse.json(createWalletChallenge(req, (await req.json()).walletAddress)) }
  catch (error) { return apiErrorResponse(error) }
}
