import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { getJob } from '@/lib/store'
import { confirmJobFunding, VaultError } from '@/lib/vault'
import { ZalletError } from '@/lib/zallet'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireActor(req)
    const { id } = await params
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (job.clientAddress !== actor) throw new ApiError(403, 'Only this job’s client can verify its vault deposit.')
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError(400, 'Invalid funding request.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw new ApiError(400, 'Funding checks use stored vault details and wallet evidence; no transaction proof can be supplied.')
    }
    return NextResponse.json(await confirmJobFunding(job), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return apiErrorResponse(error instanceof VaultError || error instanceof ZalletError ? new ApiError(error.status, error.message) : error)
  }
}
