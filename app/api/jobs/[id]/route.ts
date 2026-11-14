import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob } from '@/lib/store'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { hasUnsettledJobOperation, withJobOperation, GenLayerBusyError } from '@/lib/genlayer'
import { cancellationEligibility, JobLifecycleError } from '@/lib/job-lifecycle'
import { validateTextJob } from '@/lib/job-policy'
import { notify } from '@/lib/notify'

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
    const reason = cancellationEligibility(current, !validateTextJob(current))
    if (current.genlayerContractAddress && await hasUnsettledJobOperation(current.genlayerContractAddress)) throw new ApiError(409, 'A GenLayer operation needs reconciliation before this job can be cancelled.')
    const job = await updateJob(id, { status: 'cancelled', cancellationReason: reason, cancelledAt: new Date().toISOString() },
      { status: current.status, clientAddress: actor, workerAddress: current.workerAddress })
    if (!job) throw new ApiError(409, 'The job changed. Refresh before trying again.')
    if (current.workerAddress) await notify({ to: current.workerAddress, type: 'work_rejected', title: 'Job closed',
      body: reason === 'deadline_expired' ? 'The deadline passed without approved work. The client closed the job and may request a refund.' : 'This job requires a deliverable that this text-work marketplace does not support.', link: '/jobs/' + id,
    }).catch(() => console.error('Job closure notification unavailable'))
    return NextResponse.json({ job, message: 'Job closed. A verified deposit remains available for a client-authorized refund.' })
    })
  } catch (err) {
    return apiErrorResponse(err instanceof GenLayerBusyError || err instanceof JobLifecycleError ? new ApiError(409, err.message) : err)
  }
}
