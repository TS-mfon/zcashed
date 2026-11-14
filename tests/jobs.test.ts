import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const boundary = vi.hoisted(() => ({
  job: {} as Record<string, unknown>, actor: 'demo_client',
  getJob: vi.fn(), getAllJobs: vi.fn(), getJobsByClient: vi.fn(), getJobsByWorker: vi.fn(),
  createJob: vi.fn(), updateJob: vi.fn(), updateApplication: vi.fn(), assignJob: vi.fn(), notify: vi.fn(), createJobVault: vi.fn(),
  deployEscrowContract: vi.fn(), acceptJobOnChain: vi.fn(), generateZcashTestnetAddress: vi.fn(),
  hasUnsettledJobOperation: vi.fn(),
}))
vi.mock('@/lib/store', () => ({ ...boundary }))
vi.mock('@/lib/notify', () => ({ notify: boundary.notify }))
vi.mock('@/lib/zcash', () => ({ generateZcashTestnetAddress: boundary.generateZcashTestnetAddress }))
vi.mock('@/lib/vault', () => ({ createJobVault: boundary.createJobVault }))
vi.mock('@/lib/genlayer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/genlayer')>(),
  deployEscrowContract: boundary.deployEscrowContract, acceptJobOnChain: boundary.acceptJobOnChain,
  hasUnsettledJobOperation: boundary.hasUnsettledJobOperation,
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

import { POST as create, GET as list } from '../app/api/jobs/route'
import { POST as accept } from '../app/api/jobs/[id]/accept/route'
import { POST as assign } from '../app/api/jobs/[id]/assign/route'
import { PUT as cancel } from '../app/api/jobs/[id]/route'

const address = `0x${'1'.repeat(40)}`
const context = { params: Promise.resolve({ id: 'job1' }) }
function request(body: Record<string, unknown>, path = '/api/jobs') {
  return new NextRequest('http://localhost' + path, { method: 'POST', body: JSON.stringify(body) })
}
function offer(extra: Record<string, unknown> = {}) {
  return request({ title: 'Public summary', description: 'State the issue in a concise summary.',
    budgetZatoshis: 10000000, budgetZec: 0.1, clientAddress: 'demo_client', category: 'Writing', ...extra })
}

beforeEach(() => {
  vi.clearAllMocks()
  boundary.actor = 'demo_client'
  boundary.hasUnsettledJobOperation.mockResolvedValue(false)
  boundary.notify.mockResolvedValue(undefined)
  boundary.createJobVault.mockResolvedValue({ address: 'testnet-vault', reference: 'private-reference', network: 'testnet' })
  boundary.job = {
    id: 'job1', title: 'Public summary', description: 'State the issue in a concise summary.',
    clientAddress: 'demo_client', workerAddress: '', status: 'open', assignmentMode: 'application',
    genlayerContractAddress: address, budgetZatoshis: 10000000, budgetZec: 0.1, submissions: [],
    fundedAt: '2026-11-14T00:00:00.000Z', fundedZatoshis: 10000000,
    applications: [{ id: 'app1', applicantAddress: 'demo_worker', status: 'pending' }],
  }
  boundary.getJob.mockImplementation(async () => boundary.job)
  boundary.getAllJobs.mockImplementation(async () => [boundary.job])
  boundary.createJob.mockImplementation(async (job) => { boundary.job = job; return job })
  boundary.updateJob.mockImplementation(async (_id, updates) => { boundary.job = { ...boundary.job, ...updates }; return boundary.job })
  boundary.updateApplication.mockImplementation(async (_id, applicationId, updates) => {
    boundary.job = { ...boundary.job, applications: (boundary.job.applications as Record<string, unknown>[]).map((application) =>
      application.id === applicationId ? { ...application, ...updates } : application) }
  })
  boundary.assignJob.mockImplementation(async (id, applicationId) => {
    const applications = boundary.job.applications as Record<string, unknown>[]
    const chosen = applications.find((application) => application.id === applicationId)!
    return boundary.updateJob(id, { status: 'in_progress', workerAddress: chosen.applicantAddress,
      applications: applications.map((application) => ({ ...application, status: application.id === applicationId ? 'accepted' : 'rejected' })) })
  })
  boundary.deployEscrowContract.mockResolvedValue(address)
  boundary.acceptJobOnChain.mockResolvedValue(`0x${'2'.repeat(64)}`)
  boundary.generateZcashTestnetAddress.mockResolvedValue({ address: 'legacy-wallet', privateKeyHex: 'legacy-key' })
})

describe('job deployment and assignment APIs', () => {
  it('does not publish an open job when the real contract deployment fails', async () => {
    boundary.deployEscrowContract.mockRejectedValue(new Error('GenLayer deployment unavailable'))
    const response = await create(offer())
    expect(response.status).toBe(503)
    expect(boundary.createJob).not.toHaveBeenCalled()
  })
  it('keeps a direct job open when chain acceptance fails', async () => {
    boundary.actor = 'demo_worker'
    boundary.job = { ...boundary.job, assignmentMode: 'direct' }
    boundary.acceptJobOnChain.mockRejectedValue(new Error('Consensus acceptance failed'))
    const response = await accept(request({ workerAddress: 'demo_worker' }), context)
    expect(response.status).toBe(503)
    expect(boundary.job).toMatchObject({ status: 'open', workerAddress: '' })
    expect(boundary.notify).not.toHaveBeenCalled()
  })
  it('keeps applications pending when chain assignment fails', async () => {
    boundary.acceptJobOnChain.mockRejectedValue(new Error('Consensus acceptance failed'))
    const response = await assign(request({ applicationId: 'app1' }), context)
    expect(response.status).toBe(503)
    expect(boundary.job).toMatchObject({ status: 'open', workerAddress: '' })
    expect(boundary.updateApplication).not.toHaveBeenCalled()
  })
  it('requires the actual client even when the request omits its client identity', async () => {
    boundary.actor = 'demo_worker'
    const response = await assign(request({ applicationId: 'app1' }), context)
    expect(response.status).toBe(403)
    expect(boundary.acceptJobOnChain).not.toHaveBeenCalled()
    expect(boundary.updateApplication).not.toHaveBeenCalled()
  })
  it('publishes a successfully deployed public rubric with an exact integer budget and no generated wallet', async () => {
    const response = await create(offer({ clientAddress: undefined }))
    expect(response.status).toBe(201)
    const { job } = await response.json()
    expect(job).toMatchObject({ status: 'funding_required', clientAddress: 'demo_client', genlayerContractAddress: address, budgetZatoshis: 10000000, budgetZec: 0.1,
      vaultAddress: 'testnet-vault', vaultReference: 'private-reference', vaultNetwork: 'testnet', fundedAt: null, fundedZatoshis: 0 })
    expect(job).not.toHaveProperty('escrowAddress')
    expect(job).not.toHaveProperty('escrowPrivKey')
    expect(boundary.generateZcashTestnetAddress).not.toHaveBeenCalled()
    expect(boundary.deployEscrowContract).toHaveBeenCalledWith({ taskTitle: 'Public summary', taskDescription: 'State the issue in a concise summary.' })
  })
  it('keeps a new offer unpublished until deployment completes successfully', async () => {
    let finish!: (address: string) => void
    boundary.deployEscrowContract.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = create(offer({ deadline: '2026-12-01T12:00:00.000Z' }))
    await vi.waitFor(() => expect(boundary.deployEscrowContract).toHaveBeenCalledOnce())
    expect(boundary.createJob).not.toHaveBeenCalled()
    finish(address)
    expect((await pending).status).toBe(201)
    const response = await list(new NextRequest('http://localhost/api/jobs'))
    expect(await response.json()).toEqual({ jobs: [boundary.job] })
  })
  it.each([
    { budgetZatoshis: 0 }, { budgetZatoshis: -1 }, { budgetZatoshis: '10000000' }, { budgetZatoshis: 0.1 },
    { budgetZatoshis: 2100000000000001 }, { title: '' }, { description: 12 }, { title: 12 },
    { description: Array.from({ length: 13 }, () => 'Separate public rubric requirement').join('\n') },
    { category: 'Invented category' }, { assignmentMode: 'automatic' }, { deadline: 'not-a-date' }, { clientAddress: 42 },
  ])('rejects invalid public offer fields before deploying: %j', async (body) => {
    expect((await create(offer(body))).status).toBe(400)
    expect(boundary.deployEscrowContract).not.toHaveBeenCalled()
    expect(boundary.createJob).not.toHaveBeenCalled()
  })
  it('does not trust a forged client identity for job creation or private listings', async () => {
    expect((await create(offer({ clientAddress: 'another_client' }))).status).toBe(403)
    expect((await list(new NextRequest('http://localhost/api/jobs?address=another_client'))).status).toBe(403)
    expect(boundary.deployEscrowContract).not.toHaveBeenCalled()
    boundary.getJobsByClient.mockResolvedValue([boundary.job])
    boundary.getJobsByWorker.mockResolvedValue([])
    const response = await list(new NextRequest('http://localhost/api/jobs?address=demo_client'))
    expect(await response.json()).toEqual({ posted: [boundary.job], working: [] })
  })
  it('waits for finalized direct acceptance before changing the job or notifying the client', async () => {
    boundary.actor = 'demo_worker'
    boundary.job = { ...boundary.job, assignmentMode: 'direct' }
    let finish!: (hash: string) => void
    boundary.acceptJobOnChain.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = accept(request({}), context)
    await vi.waitFor(() => expect(boundary.acceptJobOnChain).toHaveBeenCalledOnce())
    expect(boundary.job.status).toBe('open')
    expect(boundary.notify).not.toHaveBeenCalled()
    finish(`0x${'2'.repeat(64)}`)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ job: { status: 'in_progress', workerAddress: 'demo_worker' } })
  })
  it('selects the applicant and rejects other applications after successful chain assignment', async () => {
    boundary.job = { ...boundary.job, applications: [
      ...(boundary.job.applications as unknown[]), { id: 'app2', applicantAddress: 'other_worker', status: 'pending' },
    ] }
    const response = await assign(request({ applicationId: 'app1' }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ job: { status: 'in_progress', workerAddress: 'demo_worker', applications: [
      { id: 'app1', status: 'accepted' }, { id: 'app2', status: 'rejected' },
    ] } })
  })
  it.each([
    [{ assignmentMode: 'application' }, 'demo_worker', 400], [{ status: 'in_progress' }, 'demo_worker', 400],
    [{ genlayerContractAddress: '' }, 'demo_worker', 503], [{}, 'demo_client', 400],
    [{ clientAddress: 'legacy_12345' }, 'demo_worker', 400], [{ fundedAt: null, fundedZatoshis: 0 }, 'demo_worker', 400],
  ])('rejects unavailable or unauthorized direct acceptance: %j', async (updates, actor, status) => {
    boundary.actor = String(actor)
    boundary.job = { ...boundary.job, assignmentMode: 'direct', ...updates as object }
    expect((await accept(request({}), context)).status).toBe(status)
    expect(boundary.acceptJobOnChain).not.toHaveBeenCalled()
    expect(boundary.updateJob).not.toHaveBeenCalled()
  })
  it.each([
    [{ assignmentMode: 'direct' }, 400], [{ status: 'approved' }, 400], [{ genlayerContractAddress: '' }, 503],
    [{ applications: [] }, 404], [{ applications: [{ id: 'app1', applicantAddress: 'demo_client', status: 'pending' }] }, 400],
    [{ fundedAt: null, fundedZatoshis: 0 }, 400],
  ])('rejects unavailable or invalid client assignment: %j', async (updates, status) => {
    boundary.job = { ...boundary.job, ...updates as object }
    expect((await assign(request({ applicationId: 'app1' }), context)).status).toBe(status)
    expect(boundary.acceptJobOnChain).not.toHaveBeenCalled()
    expect(boundary.updateApplication).not.toHaveBeenCalled()
  })
  it('fails before GenLayer deployment when the real vault cannot be created', async () => {
    boundary.createJobVault.mockRejectedValue(new Error('Configure Zallet testnet RPC'))
    expect((await create(offer())).status).toBe(503)
    expect(boundary.deployEscrowContract).not.toHaveBeenCalled()
    expect(boundary.createJob).not.toHaveBeenCalled()
  })
  it('commits assignment atomically and returns success when notifications fail', async () => {
    boundary.notify.mockRejectedValue(new Error('Notifications unavailable'))
    expect((await assign(request({ applicationId: 'app1' }), context)).status).toBe(200)
    expect(boundary.job).toMatchObject({ status: 'in_progress', workerAddress: 'demo_worker', applications: [{ id: 'app1', status: 'accepted' }] })
    expect((await assign(request({ applicationId: 'app1' }), context)).status).toBe(200)
    expect(boundary.acceptJobOnChain).toHaveBeenCalledOnce()
  })
  it('retries the same finalized assignment after an atomic local write fails', async () => {
    boundary.updateJob.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect((await assign(request({ applicationId: 'app1' }), context)).status).toBe(503)
    expect(boundary.job).toMatchObject({ status: 'open', workerAddress: '', applications: [{ id: 'app1', status: 'pending' }] })
    expect((await assign(request({ applicationId: 'app1' }), context)).status).toBe(200)
  })
})

it('blocks cancellation while a finalized assignment still needs persistence recovery', async () => {
  boundary.hasUnsettledJobOperation.mockResolvedValue(true)
  const req = new NextRequest('http://localhost/api/jobs/job1', {method:'PUT',body:JSON.stringify({status:'cancelled'})})
  expect((await cancel(req, context)).status).toBe(409)
  expect(boundary.updateJob).not.toHaveBeenCalled()
})
it('allows the client to cancel an untouched open job', async () => {
  const req = new NextRequest('http://localhost/api/jobs/job1', {method:'PUT',body:JSON.stringify({status:'cancelled'})})
  expect((await cancel(req, context)).status).toBe(200)
  expect(boundary.job.status).toBe('cancelled')
})
