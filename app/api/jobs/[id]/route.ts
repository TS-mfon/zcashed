import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob } from '@/lib/store'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { hasUnsettledJobOperation, withJobOperation, GenLayerBusyError } from '@/lib/genlayer'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = await getJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ job })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const actor = requireActor(req)
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid cancellation request.')
    return await withJobOperation(id, async () => {
    const current = await getJob(id)
    if (!current) throw new ApiError(404, 'Job not found')
    if (current.clientAddress !== actor) throw new ApiError(403, 'Only the client can cancel this job.')
    if (Object.keys(body).length !== 1 || body.status !== 'cancelled') throw new ApiError(400, 'Only cancellation is allowed here. Review, funding and payment states are verified by their own services.')
    if (!['funding_required', 'open'].includes(current.status) || current.workerAddress) throw new ApiError(409, 'This job has already started and cannot be cancelled here.')
    if (current.genlayerContractAddress && await hasUnsettledJobOperation(current.genlayerContractAddress)) throw new ApiError(409, 'A GenLayer operation needs reconciliation before this job can be cancelled.')
    const job = await updateJob(id, { status: 'cancelled' }, { status: current.status, clientAddress: actor })
    if (!job) throw new ApiError(409, 'The job changed. Refresh before trying again.')
    return NextResponse.json({ job })
    })
  } catch (err) {
    return apiErrorResponse(err instanceof GenLayerBusyError ? new ApiError(409, err.message) : err)
  }
}
