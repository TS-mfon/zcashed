import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { getJob } from '@/lib/store'
import { refundJobPayment, VaultError, VaultPreflightError } from '@/lib/vault'
import { ZalletError } from '@/lib/zallet'
import { hasUnsettledJobOperation, withJobOperation, GenLayerBusyError } from '@/lib/genlayer'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireActor(req)
    const { id } = await params
    return await withJobOperation(id, async () => {
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (actor !== job.clientAddress) throw new ApiError(403, 'Only this job’s client can authorize its refund.')
    if (job.genlayerContractAddress && await hasUnsettledJobOperation(job.genlayerContractAddress)) throw new ApiError(409, 'Reconcile the pending GenLayer operation before requesting a refund.')
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError(400, 'Invalid refund request.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'refundAddress')) {
      throw new ApiError(400, 'Supply only your private refund address, or an empty body to check an existing refund.')
    }
    const refundAddress = (body as { refundAddress?: unknown }).refundAddress
    if (refundAddress !== undefined && (typeof refundAddress !== 'string' || refundAddress.length > 1023)) throw new ApiError(400, 'Invalid shielded refund address.')
    const result = await refundJobPayment(job, refundAddress as string | undefined)
    return NextResponse.json(result, { status: result.job.status === 'refunded' ? 200 : 202, headers: { 'Cache-Control': 'private, no-store' } })
    })
  } catch (error) {
    if (error instanceof VaultPreflightError) return NextResponse.json({ error: error.message, stage: 'prebroadcast', retryable: true }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } })
    return apiErrorResponse(error instanceof GenLayerBusyError ? new ApiError(409, error.message) : error instanceof VaultError || error instanceof ZalletError ? new ApiError(error.status, error.message) : error)
  }
}
