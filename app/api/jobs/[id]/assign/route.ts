import { NextRequest, NextResponse } from 'next/server'
import { getJob, assignJob } from '@/lib/store'
import { notify } from '@/lib/notify'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { acceptJobOnChain, acknowledgeAssignment, GenLayerBusyError, withJobOperation } from '@/lib/genlayer'

export const maxDuration = 180

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid assignment body')
    if (body.clientAddress !== undefined && typeof body.clientAddress !== 'string') throw new ApiError(400, 'Invalid client identity')
    const actor = requireActor(req, body.clientAddress)
    if (typeof body.applicationId !== 'string' || !body.applicationId.trim()) throw new ApiError(400, 'Application ID required')
    const { id } = await params
    return await withJobOperation(id, () => assignApplicant(id, actor, body.applicationId))
  } catch (error) {
    return apiErrorResponse(error instanceof GenLayerBusyError ? new ApiError(503, error.message) : error)
  }
}

async function assignApplicant(id: string, actor: string, applicationId: string) {
  const job = await getJob(id)
  if (!job) throw new ApiError(404, 'Job not found')
  if (job.clientAddress !== actor) throw new ApiError(403, 'Only the client can assign this job')
  if (job.assignmentMode !== 'application') throw new ApiError(400, 'This job uses direct acceptance')
  const chosen = (job.applications ?? []).find((application) => application.id === applicationId)
  if (job.status === 'in_progress' && chosen?.status === 'accepted' && job.workerAddress === chosen.applicantAddress) { await acknowledgeAssignment(job.genlayerContractAddress, chosen.applicantAddress); return NextResponse.json({ job }) }
  if (job.status !== 'open' || job.workerAddress) throw new ApiError(400, 'Job is not open')
  if (!chosen || chosen.status !== 'pending') throw new ApiError(404, 'Pending application not found')
  if (chosen.applicantAddress === actor) throw new ApiError(400, 'Cannot assign your own job to yourself')
  if (!job.fundedAt || job.fundedZatoshis < job.budgetZatoshis) throw new ApiError(400, 'Fund the job vault before selecting a worker')
  if (!job.genlayerContractAddress) throw new ApiError(503, 'GenLayer contract is unavailable')
  try {
    await acceptJobOnChain(job.genlayerContractAddress, chosen.applicantAddress)
  } catch (error) {
    console.error('GenLayer assignment failed:', error)
    throw new ApiError(503, 'GenLayer assignment failed: ' + (error instanceof Error ? error.message : 'Provider unavailable'))
  }
  let updated
  try {
    updated = await assignJob(id, applicationId, actor)
    if (!updated) throw new Error('Job changed before assignment could be saved')
    await acknowledgeAssignment(job.genlayerContractAddress, chosen.applicantAddress)
  } catch (error) {
    console.error('Finalized assignment persistence failed:', error)
    throw new ApiError(503, 'Finalized assignment could not be saved. Retry the same applicant.')
  }
  await notify({
    to: chosen.applicantAddress, type: 'application_accepted', title: 'Your application was selected',
    body: 'The GenLayer assignment for "' + job.title + '" finalized. Submit your public artifact when ready.',
    link: '/jobs/' + id,
  }).catch((error) => console.error('Assignment notification failed:', error))
  for (const application of updated.applications) {
    if (application.id === chosen.id) continue
    await notify({
      to: application.applicantAddress, type: 'application_rejected', title: 'Application not selected',
      body: 'Your application for "' + job.title + '" was not selected this time.', link: '/jobs/' + job.id,
    }).catch((error) => console.error('Assignment notification failed:', error))
  }
  return NextResponse.json({ job: updated })
}
