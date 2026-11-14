import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob, getProfile } from '@/lib/store'
import { notify } from '@/lib/notify'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { acceptJobOnChain, acknowledgeAssignment, GenLayerBusyError, withJobOperation } from '@/lib/genlayer'
import { validateTextJob } from '@/lib/job-policy'
import { requireUnexpiredJob, JobLifecycleError } from '@/lib/job-lifecycle'

export const maxDuration = 180

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid acceptance body')
    if (body.workerAddress !== undefined && typeof body.workerAddress !== 'string') throw new ApiError(400, 'Invalid worker identity')
    const actor = requireActor(req, body.workerAddress)
    const { id } = await params
    return await withJobOperation(id, async () => {
      const job = await getJob(id)
      if (!job) throw new ApiError(404, 'Job not found')
      if (job.assignmentMode !== 'direct') throw new ApiError(400, 'This job requires an application')
      if (job.status === 'in_progress' && job.workerAddress === actor) { await acknowledgeAssignment(job.genlayerContractAddress, actor); return NextResponse.json({ job }) }
      const unsupported = validateTextJob(job)
      if (unsupported) throw new ApiError(400, unsupported)
      requireUnexpiredJob(job)
      if (job.status !== 'open' || job.workerAddress) throw new ApiError(400, 'Job is not open')
      if (job.clientAddress === actor) throw new ApiError(400, 'Cannot accept your own job')
      if (job.clientAddress.startsWith('legacy_')) throw new ApiError(400, 'Archived legacy jobs are read-only')
      if (!job.fundedAt || job.fundedZatoshis < job.budgetZatoshis) throw new ApiError(400, 'Fund the job vault before accepting a worker')
      if (!job.genlayerContractAddress) throw new ApiError(503, 'GenLayer contract is unavailable')
      try {
        await acceptJobOnChain(job.genlayerContractAddress, actor)
      } catch (error) {
        console.error('GenLayer acceptance failed:', error)
        throw new ApiError(503, 'GenLayer acceptance failed: ' + (error instanceof Error ? error.message : 'Provider unavailable'))
      }
      let updated
      try {
        const profile = await getProfile(actor)
        updated = await updateJob(id, { workerAddress: actor, ...(profile?.username ? { workerUsername: profile.username } : {}), status: 'in_progress' }, { status: 'open', workerAddress: '', clientAddress: job.clientAddress })
        if (!updated) throw new Error('Job changed before acceptance could be saved')
        await acknowledgeAssignment(job.genlayerContractAddress, actor)
      } catch (error) {
        console.error('Finalized acceptance persistence failed:', error)
        throw new ApiError(503, 'Finalized acceptance could not be saved. Retry this job.')
      }
      await notify({
        to: job.clientAddress, type: 'job_assigned', title: 'Your job was accepted',
        body: 'The worker accepted "' + job.title + '". The GenLayer assignment finalized successfully.',
        link: '/jobs/' + id,
      }).catch((error) => console.error('Acceptance notification failed:', error))
      return NextResponse.json({ job: updated })
    })
  } catch (error) {
    return apiErrorResponse(error instanceof GenLayerBusyError ? new ApiError(503, error.message) : error instanceof JobLifecycleError ? new ApiError(error.status, error.message) : error)
  }
}
