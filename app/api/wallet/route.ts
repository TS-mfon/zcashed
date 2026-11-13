import { NextResponse } from 'next/server'
import { generateZcashTestnetAddress } from '@/lib/zcash'

export async function POST() {
  try {
    const wallet = await generateZcashTestnetAddress()
    return NextResponse.json(wallet)
  } catch (err: any) {
    console.error('Wallet generation error:', err)
    return NextResponse.json({ error: err.message ?? 'Failed to generate wallet' }, { status: 500 })
  }
}
