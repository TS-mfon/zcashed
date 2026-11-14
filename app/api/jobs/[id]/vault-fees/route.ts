import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { getJob } from '@/lib/store'
import { getPrivateVaultFeeStatus } from '@/lib/vault'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireActor(req)
    const { id } = await params
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (actor !== job.clientAddress && actor !== job.workerAddress) throw new ApiError(403, 'Vault fee status is available to this job’s client and freelancer.')
    const status = await getPrivateVaultFeeStatus()
    return NextResponse.json({ fees: {
      ready: status.feeShortfallZatoshis === 0 && status.pendingPayouts === 0,
      shortfallZatoshis: status.feeShortfallZatoshis, pendingPayouts: status.pendingPayouts,
    } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiErrorResponse(error) }
}
