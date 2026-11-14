import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { getJob } from '@/lib/store'
import { claimJobPayment, getPrivateVaultOperation, VaultError, VaultPreflightError } from '@/lib/vault'
import { ZalletError } from '@/lib/zallet'

export const runtime = 'nodejs'
export const maxDuration = 180
const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireActor(req)
    const { id } = await params
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (actor !== job.workerAddress && actor !== job.clientAddress) throw new ApiError(403, 'This claim receipt is private to the worker and client.')
    return NextResponse.json({ operation: await getPrivateVaultOperation(id) }, { headers: privateHeaders })
  } catch (error) { return failure(error) }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireActor(req)
    const { id } = await params
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (!job.workerAddress || actor !== job.workerAddress) throw new ApiError(403, 'Only the chosen worker can claim this payout.')
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError(400, 'Invalid claim request.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'payoutAddress')) {
      throw new ApiError(400, 'Supply only a private shielded payout address, or an empty body to check an existing claim.')
    }
    const payoutAddress = (body as { payoutAddress?: unknown }).payoutAddress
    if (payoutAddress !== undefined && (typeof payoutAddress !== 'string' || payoutAddress.length > 1023)) {
      throw new ApiError(400, 'Invalid shielded payout address.')
    }
    const result = await claimJobPayment(job, payoutAddress as string | undefined)
    return NextResponse.json(result, { status: result.job.status === 'completed' ? 200 : 202, headers: privateHeaders })
  } catch (error) { return failure(error) }
}

function failure(error: unknown) {
  if (error instanceof VaultPreflightError) return NextResponse.json({ error: error.message, stage: 'prebroadcast', retryable: true }, { status: error.status, headers: privateHeaders })
  return apiErrorResponse(error instanceof VaultError || error instanceof ZalletError ? new ApiError(error.status, error.message) : error)
}
