import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const boundary = vi.hoisted(() => ({
  job: {} as Record<string, unknown>,
  actor: 'demo_worker',
  getJob: vi.fn(), updateJob: vi.fn(), addSubmission: vi.fn(), recordJobReview: vi.fn(),
  notify: vi.fn(), submitWorkOnChain: vi.fn(),
}))
vi.mock('@/lib/store', () => ({
  getJob: boundary.getJob, updateJob: boundary.updateJob, addSubmission: boundary.addSubmission, recordJobReview: boundary.recordJobReview,
}))
vi.mock('@/lib/notify', () => ({ notify: boundary.notify }))
vi.mock('@/lib/genlayer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/genlayer')>(),
  submitWorkOnChain: boundary.submitWorkOnChain,
}))
vi.mock('@/lib/auth', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  }
  return {
    ApiError,
    requireActor: (_req: NextRequest, claimed?: unknown) => {
      if (claimed !== undefined && claimed !== boundary.actor) throw new ApiError(403, 'Identity does not match session')
      return boundary.actor
    },
    apiErrorResponse: (error: unknown) => NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: error instanceof ApiError ? error.status : 500 },
    ),
  }
})

import { POST } from '../app/api/submit/route'

const artifact = 'The issue is that keyboard users cannot dismiss the editor dialog. Escape now closes it.'
function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/submit', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'job1', workerAddress: 'demo_worker', submissionUrl: '', notes: artifact, ...extra }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  boundary.notify.mockResolvedValue(undefined)
  boundary.actor = 'demo_worker'
  boundary.job = {
    id: 'job1', title: 'Public summary', description: 'State the issue in a concise summary.',
    clientAddress: 'demo_client', workerAddress: 'demo_worker', status: 'in_progress',
    genlayerContractAddress: `0x${'1'.repeat(40)}`, budgetZatoshis: 10000000, budgetZec: 0.1, submissions: [],
    fundedAt: '2026-11-14T00:00:00.000Z', fundedZatoshis: 10000000,
  }
  boundary.getJob.mockImplementation(async () => boundary.job)
  boundary.updateJob.mockImplementation(async (_id, updates) => {
    boundary.job = { ...boundary.job, ...updates }
    return boundary.job
  })
  boundary.addSubmission.mockImplementation(async (submission) => {
    boundary.job = { ...boundary.job, submissions: [...boundary.job.submissions as unknown[], submission] }
  })
  boundary.recordJobReview.mockImplementation(async (id, submission, status) => boundary.updateJob(id, {
    status, submissions: [...(boundary.job.submissions as Record<string, unknown>[]).filter((entry) => entry.id !== submission.id), submission],
  }))
  boundary.submitWorkOnChain.mockResolvedValue({
    txHash: `0x${'2'.repeat(64)}`, approved: true, rejectionReason: '', verdict: 'approved', reason: '', attempt: 1,
    criteria: [{ id: 'C1', status: 'passed', feedback: 'The supplied text states the issue.' }],
  })
})

describe('public artifact submission API', () => {
  it('fails closed and remains retriable when GenLayer is unavailable', async () => {
    boundary.submitWorkOnChain.mockRejectedValue(new Error('GenLayer RPC unavailable'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('GenLayer RPC unavailable') })
    expect(boundary.job.status).toBe('in_progress')
    expect(boundary.job.submissions).toEqual([])
  })
  it('records the finalized criterion judgment and offers a separate wallet payment', async () => {
    const response = await POST(request({ submissionText: artifact, submissionUrl: 'https://example.com/reference' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ approved: true, verdict: 'approved', txHash: `0x${'2'.repeat(64)}` })
    expect(boundary.job.status).toBe('approved')
    expect(boundary.job.submissions).toEqual([expect.objectContaining({ notes: artifact, status: 'approved', aiFeedback: expect.stringContaining('C1 (passed)') })])
    expect(boundary.submitWorkOnChain).toHaveBeenCalledWith(boundary.job.genlayerContractAddress, artifact, 'demo_worker', 1)
    expect(JSON.stringify(boundary.notify.mock.calls)).not.toMatch(/released|completed|escrow/i)
  })
  it.each(['needs_revision', 'inconclusive'])('keeps %s judgments unpaid and provides criterion feedback', async (verdict) => {
    boundary.submitWorkOnChain.mockResolvedValue({
      txHash: `0x${'2'.repeat(64)}`, approved: false, verdict, rejectionReason: 'C1: Supply the public source text.',
      criteria: [{ id: 'C1', status: verdict === 'inconclusive' ? 'inconclusive' : 'failed', feedback: 'Supply the public source text.' }],
    })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ approved: false, verdict, rejectionReason: 'C1: Supply the public source text.' })
    expect(boundary.job.status).toBe('needs_revision')
    expect(boundary.job.submissions).toEqual([expect.objectContaining({ status: verdict })])
  })
  it('requires a deployed contract instead of using a local approval fallback', async () => {
    boundary.job = { ...boundary.job, genlayerContractAddress: '' }
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(boundary.submitWorkOnChain).not.toHaveBeenCalled()
    expect(boundary.job.status).toBe('in_progress')
  })
  it('authorizes the assigned session actor before contacting the judging provider', async () => {
    boundary.actor = 'other_worker'
    const response = await POST(request({ workerAddress: 'other_worker' }))
    expect(response.status).toBe(403)
    expect(boundary.submitWorkOnChain).not.toHaveBeenCalled()
    expect(boundary.updateJob).not.toHaveBeenCalled()
  })
  it.each([
    { notes: 'https://example.com/a/long/public/path' }, { notes: 'HTTPS://example.com/a/long/public/path' }, { submissionText: '' }, { notes: 42 },
    { submissionUrl: 'http://example.com/private' }, { submissionUrl: 'https://secret@example.com/artifact' },
    { notes: 'x'.repeat(12001) }, { jobId: 42 }, { workerAddress: 42 },
  ])('rejects missing evidence or invalid submission fields before the provider: %j', async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(boundary.submitWorkOnChain).not.toHaveBeenCalled()
    expect(boundary.updateJob).not.toHaveBeenCalled()
  })
  it('rejects missing jobs and jobs that are not accepting submissions', async () => {
    boundary.getJob.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(404)
    boundary.job = { ...boundary.job, status: 'approved' }
    expect((await POST(request())).status).toBe(400)
    expect(boundary.submitWorkOnChain).not.toHaveBeenCalled()
  })
  it('rejects duplicate submissions during finalization and releases the lock after a provider failure', async () => {
    let fail!: (reason: Error) => void
    boundary.submitWorkOnChain.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const first = POST(request())
    await vi.waitFor(() => expect(boundary.submitWorkOnChain).toHaveBeenCalledOnce())
    expect(boundary.job.status).toBe('in_progress')
    expect(boundary.updateJob).not.toHaveBeenCalled()
    expect((await POST(request())).status).toBe(503)
    fail(new Error('Finalization timed out'))
    expect((await first).status).toBe(503)
    expect((await POST(request())).status).toBe(200)
  })
  it('atomically stores the verdict and submission and can retry a failed local write', async () => {
    boundary.updateJob.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect((await POST(request())).status).toBe(503)
    expect(boundary.job).toMatchObject({ status: 'in_progress', submissions: [] })
    expect((await POST(request())).status).toBe(200)
    expect(boundary.job.submissions).toEqual([expect.objectContaining({ attempt: 1, status: 'approved' })])
  })
  it('returns the saved finalized decision even when a notification cannot be delivered', async () => {
    boundary.notify.mockRejectedValue(new Error('Notification storage unavailable'))
    expect((await POST(request())).status).toBe(200)
    expect(boundary.job.status).toBe('approved')
    boundary.notify.mockResolvedValue(undefined)
  })
  it('makes the third nonpassing adjudication rejected and blocks a fourth attempt', async () => {
    boundary.job = { ...boundary.job, submissions: [
      { id: 'first', attempt: 1, notes: 'First public text', genlayerTxHash: 'hash1', status: 'needs_revision' },
      { id: 'second', attempt: 2, notes: 'Second public text', genlayerTxHash: 'hash2', status: 'needs_revision' },
    ] }
    boundary.submitWorkOnChain.mockResolvedValue({ txHash: `0x${'2'.repeat(64)}`, approved: false, verdict: 'rejected',
      attempt: 3, rejectionReason: 'C1: Missing source text.', criteria: [{ id: 'C1', status: 'failed', feedback: 'Missing source text.' }] })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ verdict: 'rejected', attempt: 3, remainingAttempts: 0, maxAttempts: 3 })
    expect(boundary.job.status).toBe('rejected')
    expect((await POST(request({ submissionText: artifact + ' A fourth draft.' }))).status).toBe(400)
    expect(boundary.submitWorkOnChain).toHaveBeenCalledOnce()
  })
  it('does not judge work before the job vault is funded', async () => {
    boundary.job = { ...boundary.job, fundedAt: null, fundedZatoshis: 0 }
    expect((await POST(request())).status).toBe(400)
    expect(boundary.submitWorkOnChain).not.toHaveBeenCalled()
  })
})
