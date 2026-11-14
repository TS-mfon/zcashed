import { NextRequest, NextResponse } from 'next/server'
import { getApplicationsByApplicant } from '@/lib/store'
import { apiErrorResponse, requireActor } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const address = new URL(req.url).searchParams.get('address')
    const actor = requireActor(req, address ?? undefined)
    return NextResponse.json({ applications: await getApplicationsByApplicant(actor) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiErrorResponse(error) }
}
