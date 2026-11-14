import type { Job } from './types'

const DAY = 24 * 60 * 60 * 1000
export const DEFAULT_JOB_DURATION = 7 * DAY

export class JobLifecycleError extends Error {
  constructor(message: string, readonly status = 409) { super(message) }
}

export function normalizeJobDeadline(value: unknown, now = Date.now()): string {
  if (value === undefined || value === null || value === '') return new Date(now + DEFAULT_JOB_DURATION).toISOString()
  if (typeof value !== 'string') throw new JobLifecycleError('Choose a valid job deadline.', 400)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp < now + 60 * 60 * 1000 || timestamp > now + 90 * DAY) {
    throw new JobLifecycleError('Choose a deadline between one hour and 90 days from now. All revisions must be submitted before it.', 400)
  }
  return new Date(timestamp).toISOString()
}

export function jobDeadline(job: Pick<Job, 'createdAt' | 'deadline'>): string {
  const timestamp = job.deadline ? Date.parse(job.deadline) : Date.parse(job.createdAt) + DEFAULT_JOB_DURATION
  if (!Number.isFinite(timestamp)) throw new JobLifecycleError('This job has an invalid stored deadline. Contact the operator.')
  return new Date(timestamp).toISOString()
}

export function isJobExpired(job: Pick<Job, 'createdAt' | 'deadline'>, now = Date.now()): boolean {
  return Date.parse(jobDeadline(job)) <= now
}

export function requireUnexpiredJob(job: Job): void {
  if (isJobExpired(job)) throw new JobLifecycleError('The job deadline has passed. New applications, assignments and submissions are closed; the client can close the job and request a refund.')
}

export function cancellationEligibility(job: Job, supported: boolean): Job['cancellationReason'] {
  if (['funding_required', 'open'].includes(job.status) && !job.workerAddress) return isJobExpired(job) ? 'deadline_expired' : supported ? 'client_cancelled' : 'unsupported_job'
  if (!['in_progress', 'needs_revision', 'under_review'].includes(job.status)) throw new JobLifecycleError('This job cannot be cancelled. Approved work and reserved payouts remain payable.')
  if (!supported) return 'unsupported_job'
  if (isJobExpired(job)) return 'deadline_expired'
  throw new JobLifecycleError('The freelancer is still within the agreed deadline. You can close an unfinished job after its deadline.')
}
