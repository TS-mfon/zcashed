import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Wallet generation is disabled. Connect your existing Zcash wallet and approve payments in that wallet.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
