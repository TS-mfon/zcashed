import { NextRequest, NextResponse } from 'next/server'
import { getApplicationsByApplicant } from '@/lib/store'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ applications: [] })
  const applications = await getApplicationsByApplicant(address)
  return NextResponse.json({ applications })
}
