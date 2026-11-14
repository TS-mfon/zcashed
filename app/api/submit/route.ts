import { NextRequest, NextResponse } from 'next/server'
import { getJob, recordJobReview } from '@/lib/store'
import { notify } from '@/lib/notify'
import { createHash } from 'node:crypto'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { acknowledgeReview, GenLayerBusyError, submitWorkOnChain, withJobOperation, hasRecoverableReview } from '@/lib/genlayer'
import type { Submission, Job } from '@/lib/types'
import { validateTextJob, validateTextSubmission } from '@/lib/job-policy'
import { requireUnexpiredJob, JobLifecycleError } from '@/lib/job-lifecycle'

export const maxDuration = 180

type ReviewResult = Awaited<ReturnType<typeof submitWorkOnChain>>

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid submission body')
    if (body.workerAddress !== undefined && typeof body.workerAddress !== 'string') throw new ApiError(400, 'Invalid worker identity')
    const actor = requireActor(req, body.workerAddress)
    const { jobId, artifact, submissionUrl, claimedAttempt } = submissionInput(body)
    return await withJobOperation(jobId, () => reviewSubmission(jobId, actor, artifact, submissionUrl, claimedAttempt))
  } catch (error) {
    return apiErrorResponse(error instanceof GenLayerBusyError ? new ApiError(503, error.message) : error instanceof JobLifecycleError ? new ApiError(error.status, error.message) : error)
  }
}

async function reviewSubmission(jobId: string, actor: string, artifact: string, submissionUrl: string, claimedAttempt?: number) {
    const job = await getJob(jobId)
    if (!job) throw new ApiError(404, 'Job not found')
    if (job.workerAddress !== actor) throw new ApiError(403, 'Only the assigned worker can submit')
    const operation = submissionAttempt(job, artifact, claimedAttempt)
    const recovering = operation.replay || (job.genlayerContractAddress && await hasRecoverableReview(job.genlayerContractAddress, artifact, actor, operation.attempt))
    if (!recovering) {
      const unsupported = validateTextJob(job)
      if (unsupported) throw new ApiError(400, unsupported)
      requireUnexpiredJob(job)
    }
    if (!['in_progress', 'needs_revision'].includes(job.status) && !(operation.replay && ['approved', 'rejected'].includes(job.status))) throw new ApiError(400, 'Cannot submit work in status: ' + job.status)
    if (!job.fundedAt || job.fundedZatoshis < job.budgetZatoshis) throw new ApiError(400, 'Job vault funding has not been verified')
    if (!job.genlayerContractAddress) throw new ApiError(503, 'GenLayer contract is unavailable; retry after deployment succeeds')
    let result: ReviewResult
    try {
      result = await submitWorkOnChain(job.genlayerContractAddress, artifact, actor, operation.attempt)
    } catch (error) {
      console.error('GenLayer submission failed:', error)
      throw new ApiError(503, 'GenLayer review failed: ' + (error instanceof Error ? error.message : 'Provider unavailable'))
    }
    const attempt = await saveVerdict(job, actor, artifact, submissionUrl, result)
    return NextResponse.json({
      approved: result.approved,
      verdict: result.verdict,
      txHash: result.txHash,
      rejectionReason: result.rejectionReason,
      criteria: result.criteria,
      attempt,
      remainingAttempts: Math.max(0, 3 - attempt),
      maxAttempts: 3,
      message: result.approved ? 'Public artifact approved. The worker may claim the funded testnet reward from the demo vault.' :
        result.verdict === 'rejected' ? 'Work rejected after three adjudications. The client may request a vault refund.' :
        result.verdict === 'inconclusive' ? 'Evidence is inconclusive. Add the missing public evidence and resubmit.' : 'Revision requested. Review the criterion feedback.',
    })
}

function submissionInput(body: Record<string, unknown>) {
  if (typeof body.jobId !== 'string' || !body.jobId.trim() || body.jobId.length > 100) throw new ApiError(400, 'Valid job ID required')
  const value = body.submissionText ?? body.notes
  if (typeof value !== 'string' || value.trim().length < 20 || value.trim().length > 12000) {
    throw new ApiError(400, 'Paste the actual public deliverable text (20-12000 characters)')
  }
  const artifact = value.trim()
  const textError = validateTextSubmission(artifact, body.submissionUrl)
  if (textError) throw new ApiError(400, textError)
  if (artifact.replace(/https?:\/\/\S+/gi, '').trim().length < 20) throw new ApiError(400, 'A URL alone is not evidence. Paste the public deliverable text.')
  const submissionUrl = body.submissionUrl ?? ''
  if (typeof submissionUrl !== 'string' || submissionUrl.length > 2000) throw new ApiError(400, 'Invalid submission URL')
  if (submissionUrl) {
    try {
      const url = new URL(submissionUrl)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid protocol')
    } catch {
      throw new ApiError(400, 'Submission URL must be a valid public HTTPS URL')
    }
  }
  if (body.attempt !== undefined && (typeof body.attempt !== 'number' || !Number.isSafeInteger(body.attempt) || body.attempt < 1 || body.attempt > 3)) throw new ApiError(400, 'Submission attempt must be between one and three')
  return { jobId: body.jobId, artifact, submissionUrl, claimedAttempt: body.attempt as number | undefined }
}

function submissionAttempt(job: Job, artifact: string, claimed?: number) {
  const submissions = job.submissions ?? []
  const last = submissions.at(-1)
  const terminalReplay = ['approved', 'rejected'].includes(job.status) && last?.notes === artifact ? last.attempt : undefined
  const attempt = claimed ?? terminalReplay ?? submissions.length + 1
  if (attempt > 3) throw new ApiError(400, 'The maximum three adjudications have been reached')
  if (attempt > submissions.length + 1) throw new ApiError(409, 'Refresh the job before submitting the next attempt')
  const existing = submissions.find((submission) => submission.attempt === attempt)
  if (existing && existing.notes !== artifact) throw new ApiError(409, 'This attempt belongs to another public artifact. Refresh the job.')
  return { attempt, replay: Boolean(existing) }
}

async function saveVerdict(job: Job, actor: string, artifact: string, submissionUrl: string, result: ReviewResult) {
  const existing = job.submissions?.find((submission) => submission.genlayerTxHash === result.txHash)
  const attempt = existing?.attempt ?? result.attempt ?? (job.submissions?.length ?? 0) + 1
  const submission: Submission = {
    id: existing?.id ?? 'submission_' + createHash('sha256').update(job.id + ':' + result.txHash).digest('hex').slice(0, 32), jobId: job.id, workerAddress: actor, submissionUrl,
    notes: artifact,
    status: result.verdict as Submission['status'],
    aiFeedback: result.criteria.map((criterion) => criterion.id + ' (' + criterion.status + '): ' + criterion.feedback).join('\n'),
    attempt,
    genlayerTxHash: result.txHash,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
  try {
    const saved = await recordJobReview(job.id, submission, result.approved ? 'approved' : result.verdict === 'rejected' ? 'rejected' : 'needs_revision', actor)
    if (!saved) throw new Error('Job changed before the finalized review could be saved')
    await acknowledgeReview(job.genlayerContractAddress, artifact, actor, attempt)
  } catch (error) {
    console.error('Finalized GenLayer review persistence failed:', error)
    throw new ApiError(503, 'Finalized review could not be saved. Retry the same public artifact: ' + (error instanceof Error ? error.message : 'Storage unavailable'))
  }
  await notify({
    to: actor, type: result.approved ? 'work_approved' : 'work_rejected',
    title: result.approved ? 'Public artifact approved' : result.verdict === 'rejected' ? 'Work rejected' : result.verdict === 'inconclusive' ? 'More evidence needed' : 'Revision requested',
    body: result.approved ? 'The finalized GenLayer judgment approved your public artifact. Your funded testnet reward is eligible for a vault claim.' : result.rejectionReason,
    link: '/jobs/' + job.id,
  }).catch((error) => console.error('Review notification failed:', error))
  await notify({
    to: job.clientAddress, type: result.approved ? 'work_approved' : 'work_submitted',
    title: result.approved ? 'Work approved' : 'Review completed',
    body: result.approved ? 'GenLayer approved the public artifact. The worker may request a shielded payout from the funded testnet vault.' : 'Review the criterion feedback for this submission.',
    link: '/jobs/' + job.id,
  }).catch((error) => console.error('Review notification failed:', error))
  return attempt
}
