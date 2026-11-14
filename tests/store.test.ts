import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Application, Job, Notification, Profile, Submission } from '../lib/types'

const mongo = vi.hoisted(() => ({ database: vi.fn(), collection: vi.fn(), find: vi.fn(),
  findOne: vi.fn(), insertOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn(),
  updateMany: vi.fn(), replaceOne: vi.fn(), toArray: vi.fn(), sort: vi.fn() }))
vi.mock('../lib/mongodb', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/mongodb')>(), getMongoDatabase: mongo.database,
}))
const driver = vi.hoisted(() => ({ construct: vi.fn(), connect: vi.fn(), close: vi.fn(), db: vi.fn() }))
vi.mock('mongodb', () => ({ MongoClient: class {
  constructor(uri: string, options: unknown) { driver.construct(uri, options) }
  connect() { return driver.connect() }
  close() { return driver.close() }
  db(name: string) { return driver.db(name) }
} }))

const client = 'user_' + '1'.repeat(64)
const worker = 'user_' + '2'.repeat(64)
const createdAt = '2026-11-14T10:00:00.000Z'
let directory: string
let store: typeof import('../lib/store')

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job1', title: 'Public text', description: 'Explain the public issue in clear words.',
    category: 'Writing', budgetZatoshis: 10000000, budgetZec: 0.1, assignmentMode: 'application',
    clientAddress: client, workerAddress: '', status: 'open', genlayerContractAddress: '',
    vaultAddress: '', vaultReference: '', vaultNetwork: 'testnet', fundedAt: null, fundedZatoshis: 0,
    deadline: null, createdAt, updatedAt: createdAt, submissions: [], applications: [], ...overrides,
  }
}
const application = (): Application => ({ id: 'app1', jobId: 'job1', applicantAddress: worker,
  applicantName: 'Worker', coverLetter: 'I can do this.', proposedPrice: 0.1, status: 'pending', createdAt })
const submission = (): Submission => ({ id: 'sub1', jobId: 'job1', workerAddress: worker,
  submissionUrl: '', notes: 'The actual public text.', status: 'pending', aiFeedback: '', attempt: 1,
  genlayerTxHash: '', createdAt })
const profile = (): Profile => ({ address: worker, displayName: 'Worker', role: 'freelancer',
  bio: '', skills: ['Writing'], createdAt })
const notification = (id = 'note1', recipientAddress = worker): Notification => ({ id,
  recipientAddress, type: 'welcome', title: 'Welcome', body: 'Ready for work', link: '/dashboard', read: false, createdAt })

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mongo.database.mockResolvedValue(null)
  mongo.collection.mockReturnValue(mongo)
  mongo.find.mockReturnValue(mongo)
  mongo.sort.mockReturnValue(mongo)
  mongo.toArray.mockResolvedValue([])
  mongo.findOne.mockResolvedValue(null)
  mongo.insertOne.mockResolvedValue({ acknowledged: true })
  mongo.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
  mongo.updateMany.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
  mongo.replaceOne.mockResolvedValue({ acknowledged: true })
  driver.connect.mockResolvedValue(undefined)
  driver.close.mockResolvedValue(undefined)
  driver.db.mockReturnValue({ collection: mongo.collection })
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('MONGODB_URI', '')
  vi.stubEnv('MONGODB_DB', 'zcashed_test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  directory = mkdtempSync(path.join(tmpdir(), 'zcashed-store-'))
  vi.stubEnv('ZCASHED_DATA_DIR', directory)
  store = await import('../lib/store')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('public storage normalization', () => {
  it('normalizes legacy rows without exposing keys or native actor addresses', async () => {
    const { normalizeJob } = await import('../lib/filedb')
    const raw = { ...job(), budgetZatoshis: undefined, clientAddress: 'tmLegacyClient',
      workerAddress: 'tmLegacyWorker', escrowAddress: 'tmUnsafeEscrow', escrowPrivKey: 'synthetic-key',
      arbitrarySecret: 'synthetic', applications: [{ ...application(), applicantAddress: 'tmLegacyWorker', privateKey: 'synthetic' }],
      submissions: [{ ...submission(), workerAddress: 'tmLegacyWorker', walletSeed: 'synthetic' }] }
    const clean = normalizeJob(raw)
    expect(clean.budgetZatoshis).toBe(10000000)
    expect(clean.clientAddress).toMatch(/^legacy_[0-9a-f]{24}$/)
    expect(clean.workerAddress).toBe(clean.applications[0].applicantAddress)
    expect(clean.workerAddress).toBe(clean.submissions[0].workerAddress)
    expect('escrowPrivKey' in clean).toBe(false)
    expect('escrowAddress' in clean).toBe(false)
    expect('arbitrarySecret' in clean).toBe(false)
    expect('privateKey' in clean.applications[0]).toBe(false)
    expect('walletSeed' in clean.submissions[0]).toBe(false)
    expect(normalizeJob(raw).clientAddress).toBe(clean.clientAddress)
  })
  it.each([NaN, Infinity, -1, 21000001])('rejects unsafe legacy budgets: %s', async (budgetZec) => {
    const { normalizeJob } = await import('../lib/filedb')
    expect(() => normalizeJob({ ...job(), budgetZatoshis: undefined, budgetZec })).toThrow(/budget/i)
  })
  it.each([0, -1, 0.5, NaN, Infinity, 2100000000000001])('rejects unsafe exact zatoshi amounts: %s', async (budgetZatoshis) => {
    const { normalizeJob } = await import('../lib/filedb')
    expect(() => normalizeJob({ ...job(), budgetZatoshis })).toThrow(/budget/i)
  })
  it('rejects corrupt statuses, nested collections, and profile or notification fields', async () => {
    const clean = await import('../lib/filedb')
    expect(() => clean.normalizeJob({ ...job(), budgetZatoshis: undefined, budgetZec: 0.000000011 })).toThrow(/precision/i)
    expect(() => clean.normalizeJob({ ...job(), status: 'fake' })).toThrow(/status/i)
    expect(() => clean.normalizeJob({ ...job(), title: 1 })).toThrow(/field/i)
    expect(() => clean.normalizeJob({ ...job(), deadline: false })).toThrow(/deadline/i)
    expect(() => clean.normalizeJob({ ...job(), applications: {} })).toThrow(/list/i)
    expect(() => clean.normalizeApplication({ ...application(), proposedPrice: Infinity })).toThrow(/price/i)
    expect(() => clean.normalizeSubmission({ ...submission(), attempt: 0 })).toThrow(/attempt/i)
    expect(() => clean.normalizeProfile({ ...profile(), skills: [1] })).toThrow(/skills/i)
    expect(() => clean.normalizeNotification({ ...notification(), read: 'yes' })).toThrow(/read/i)
    expect(() => clean.requireUserId('legacy_' + '1'.repeat(24))).toThrow(/identity/i)
  })
})

describe('file-backed public storage API', () => {
  it('persists and updates jobs without mutating caller objects', async () => {
    const original = job()
    await store.createJob(original)
    const updates = Object.freeze({ title: 'Updated title' })
    const updated = await store.updateJob(original.id, updates)
    expect(updated?.title).toBe('Updated title')
    expect(original.title).toBe('Public text')
    expect((await store.getJobsByClient(client)).length).toBe(1)
    expect(await store.getJobsByWorker(worker)).toEqual([])
    expect(await store.getJob('missing')).toBeNull()
    expect(await store.updateJob('missing', { title: 'No' })).toBeNull()
    await expect(store.createJob(original)).rejects.toThrow(/already exists/i)
  })
  it('uses compare-and-set updates to reject a stale assignment', async () => {
    await store.createJob(job())
    expect(await store.updateJob('job1', { status: 'in_progress', workerAddress: worker }, { status: 'open' })).not.toBeNull()
    expect(await store.updateJob('job1', { workerAddress: client }, { status: 'open' })).toBeNull()
    expect((await store.getJobsByWorker(worker)).length).toBe(1)
  })
  it('keeps job identity and ownership immutable and maintains exact amount updates', async () => {
    await store.createJob(job())
    await expect(store.updateJob('job1', { id: 'another' })).rejects.toThrow(/immutable/i)
    await expect(store.updateJob('job1', { clientAddress: worker })).rejects.toThrow(/immutable/i)
    expect((await store.updateJob('job1', { budgetZec: 0.25 }))?.budgetZatoshis).toBe(25000000)
    expect((await store.updateJob('job1', { budgetZatoshis: 1 }))?.budgetZec).toBe(0.00000001)
  })
  it('persists nested applications and replaces a submission by its ID', async () => {
    await store.createJob(job())
    await store.addApplication(application())
    await store.updateApplication('job1', 'app1', { status: 'accepted' })
    expect((await store.getApplicationsByApplicant(worker))[0].status).toBe('accepted')
    await store.addSubmission(submission())
    await store.addSubmission({ ...submission(), status: 'approved' })
    const loaded = await store.getJob('job1')
    expect(loaded?.submissions.length).toBe(1)
    expect(loaded?.submissions[0].status).toBe('approved')
    await expect(store.addApplication(application())).rejects.toThrow(/already exists/i)
    await expect(store.addApplication({ ...application(), jobId: 'missing' })).rejects.toThrow(/missing/i)
    await expect(store.updateApplication('job1', 'missing', { status: 'accepted' })).rejects.toThrow(/missing/i)
    await expect(store.addSubmission({ ...submission(), jobId: 'missing' })).rejects.toThrow(/missing/i)
  })
  it('rejects duplicate applicants with different application IDs and closes application intake after assignment', async () => {
    await store.createJob(job())
    const results = await Promise.allSettled([
      store.addApplication(application()), store.addApplication({ ...application(), id: 'app2' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1)
    expect((await store.getJob('job1'))?.applications.length).toBe(1)
    await store.updateJob('job1', { status: 'in_progress', workerAddress: worker })
    await expect(store.addApplication({ ...application(), id: 'app3', applicantAddress: client })).rejects.toThrow(/open application job/i)
  })
  it('atomically assigns one applicant and resolves every current application status', async () => {
    await store.createJob(job())
    await store.addApplication(application())
    await store.addApplication({ ...application(), id: 'app2', applicantAddress: 'user_' + '3'.repeat(64) })
    expect(await store.assignJob('job1', 'app1', worker)).toBeNull()
    const assigned = await store.assignJob('job1', 'app1', client)
    expect(assigned?.workerAddress).toBe(worker)
    expect(assigned?.applications.map((app) => app.status)).toEqual(['accepted', 'rejected'])
    expect(await store.assignJob('job1', 'app2', client)).toBeNull()
  })
  it('rejects generic nested-array replacement after callers migrate to atomic helpers', async () => {
    await store.createJob(job())
    await expect(store.updateJob('job1', { applications: [application()] })).rejects.toThrow(/nested storage/i)
    await expect(store.updateJob('job1', { submissions: [submission()] })).rejects.toThrow(/nested storage/i)
  })
  it('records at most three unique judgments and retries the same finalized result idempotently', async () => {
    await store.createJob(job({ workerAddress: worker, status: 'in_progress' }))
    expect(await store.recordJobReview('job1', { ...submission(), status: 'needs_revision' }, 'needs_revision', client)).toBeNull()
    for (let index = 1; index <= 3; index++) {
      const final = index === 3
      const reviewed = await store.recordJobReview('job1', { ...submission(), id: 'sub' + index,
        genlayerTxHash: 'tx' + index, status: final ? 'rejected' : 'needs_revision' }, final ? 'rejected' : 'needs_revision', worker)
      expect(reviewed?.submissions[index - 1].attempt).toBe(index)
    }
    const retried = await store.recordJobReview('job1', { ...submission(), id: 'sub3',
      genlayerTxHash: 'tx3', status: 'rejected', attempt: 99 }, 'rejected', worker)
    expect(retried?.submissions.length).toBe(3)
    expect(retried?.submissions[2].attempt).toBe(3)
    expect(await store.recordJobReview('job1', { ...submission(), id: 'sub4', status: 'approved' }, 'approved', worker)).toBeNull()
    await expect(store.recordJobReview('job1', { ...submission(), id: 'sub3', genlayerTxHash: 'tx3',
      notes: 'Different artifact', status: 'rejected' }, 'rejected', worker)).rejects.toThrow(/does not match/i)
  })
  it('counts unique finalized transactions and makes the third nonpassing review terminal', async () => {
    await store.createJob(job({ workerAddress: worker, status: 'in_progress' }))
    await store.recordJobReview('job1', { ...submission(), genlayerTxHash: 'tx1', status: 'needs_revision' }, 'needs_revision', worker)
    const duplicate = await store.recordJobReview('job1', { ...submission(), id: 'different', genlayerTxHash: 'tx1', status: 'needs_revision' }, 'needs_revision', worker)
    expect(duplicate?.submissions.length).toBe(1)
    for (let index = 2; index <= 3; index++) {
      await store.recordJobReview('job1', { ...submission(), id: 'sub' + index, genlayerTxHash: 'tx' + index, status: 'inconclusive' }, 'needs_revision', worker)
    }
    const final = await store.getJob('job1')
    expect(final?.status).toBe('rejected')
    expect(final?.submissions[2].status).toBe('rejected')
  })
  it('persists profiles and scopes notification read changes to their recipient', async () => {
    const original = profile()
    await store.upsertProfile(original)
    await store.upsertProfile({ ...original, displayName: 'Updated worker' })
    expect((await store.getProfile(worker))?.displayName).toBe('Updated worker')
    expect((await store.getAllProfiles()).length).toBe(1)
    expect(await store.getProfile(client)).toBeNull()
    expect(original.displayName).toBe('Worker')
    await store.addNotification(notification())
    await store.addNotification(notification('note2', client))
    await store.markNotificationRead('note1', client)
    expect((await store.getNotifications(worker))[0].read).toBe(false)
    await store.markNotificationRead('note1', worker)
    expect((await store.getNotifications(worker))[0].read).toBe(true)
    await store.markAllNotificationsRead(client)
    expect((await store.getNotifications(client))[0].read).toBe(true)
    await expect(store.addNotification(notification())).rejects.toThrow(/already exists/i)
  })
  it('rejects mismatched nested record jobs and strips unknown profile or notification fields', async () => {
    await store.createJob(job())
    const { fileJobs } = await import('../lib/filedb')
    expect(() => fileJobs.addApplication('job1', { ...application(), jobId: 'different' })).toThrow(/match/i)
    expect(() => fileJobs.addSubmission('job1', { ...submission(), jobId: 'different' })).toThrow(/match/i)
    await store.upsertProfile({ ...profile(), ...{ privateKey: 'synthetic' } })
    await store.addNotification({ ...notification(), ...{ spendingKey: 'synthetic' } })
    expect('privateKey' in (await store.getAllProfiles())[0]).toBe(false)
    expect('spendingKey' in (await store.getNotifications(worker))[0]).toBe(false)
  })
  it('keeps legacy records readable but prevents assigning their ownership', async () => {
    writeFileSync(path.join(directory, 'jobs.json'), JSON.stringify([{ ...job(), clientAddress: 'tmLegacy' }]))
    const records = await store.getAllJobs()
    expect(records.length).toBe(1)
    expect(records[0].clientAddress).toMatch(/^legacy_/)
    await expect(store.updateJob('job1', { clientAddress: client })).rejects.toThrow(/legacy.*read.only/i)
    expect((await store.getAllJobs()).length).toBe(1)
  })
  it.each(['{corrupt', '{}', '[null]'])('reports corrupt storage rather than overwriting it', async (contents) => {
    const filename = path.join(directory, 'jobs.json')
    writeFileSync(filename, contents)
    await expect(store.getAllJobs()).rejects.toThrow(/invalid|corrupt/i)
    await expect(store.createJob(job())).rejects.toThrow(/invalid|corrupt/i)
    expect(readFileSync(filename, 'utf8')).toBe(contents)
  })
  it('requires MongoDB configuration in production instead of writing local files', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(store.createJob(job())).rejects.toThrow(/MONGODB_URI/)
  })
  it('reports a filesystem read failure instead of returning empty records', async () => {
    mkdirSync(path.join(directory, 'profiles.json'))
    await expect(store.getAllProfiles()).rejects.toThrow(/read local storage/i)
  })
  it('reports a filesystem write failure rather than claiming successful persistence', async () => {
    const missingFile = path.join(directory, 'uncreated')
    writeFileSync(missingFile, 'not a directory')
    vi.stubEnv('ZCASHED_DATA_DIR', missingFile)
    await expect(store.upsertProfile(profile())).rejects.toThrow(/local storage/i)
  })
})

describe('MongoDB boundary', () => {
  beforeEach(() => {
    vi.stubEnv('MONGODB_URI', 'mongodb://synthetic.invalid/zcashed')
    mongo.database.mockResolvedValue({ collection: mongo.collection })
  })
  it('prefers configured MongoDB and returns only normalized public job fields', async () => {
    mongo.toArray.mockResolvedValue([{ ...job(), _id: 'job1', escrowPrivKey: 'synthetic', walletSeed: 'synthetic' }])
    const records = await store.getAllJobs()
    expect(store.storageBackend()).toBe('MongoDB')
    expect(records.length).toBe(1)
    expect('escrowPrivKey' in records[0]).toBe(false)
    expect('walletSeed' in records[0]).toBe(false)
    expect('_id' in records[0]).toBe(false)
    expect(mongo.collection).toHaveBeenCalledWith('jobs')
    expect(existsSync(path.join(directory, 'jobs.json'))).toBe(false)
  })
  it('propagates read failures and never falls back to local records', async () => {
    mongo.toArray.mockRejectedValue(new Error('synthetic driver failure'))
    await expect(store.getAllJobs()).rejects.toThrow(/MongoDB storage operation failed: list jobs/)
    expect(existsSync(path.join(directory, 'jobs.json'))).toBe(false)
  })
  it('does not claim success or write a fallback file after a driver write failure', async () => {
    mongo.insertOne.mockRejectedValueOnce(new Error('synthetic driver failure'))
    await expect(store.createJob(job())).rejects.toThrow(/MongoDB storage operation failed: create job/)
    expect(existsSync(path.join(directory, 'jobs.json'))).toBe(false)
  })
  it('requires an acknowledged write and uses the job ID as the unique document key', async () => {
    mongo.insertOne.mockResolvedValueOnce({ acknowledged: false })
    await expect(store.createJob(job())).rejects.toThrow(/acknowledge/)
    const saved = await store.createJob(job())
    expect(saved.id).toBe('job1')
    expect(mongo.insertOne).toHaveBeenLastCalledWith({ ...job(), _id: 'job1' })
  })
  it('includes expected status in an atomic scalar update without replacing nested arrays', async () => {
    mongo.findOne.mockResolvedValue(job())
    mongo.findOneAndUpdate.mockResolvedValue({ ...job(), status: 'in_progress', workerAddress: worker })
    await store.updateJob('job1', { status: 'in_progress', workerAddress: worker }, { status: 'open' })
    const [filter, update] = mongo.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ _id: 'job1', status: 'open' })
    expect(update.$set.status).toBe('in_progress')
    expect('applications' in update.$set).toBe(false)
    expect('submissions' in update.$set).toBe(false)
    mongo.findOneAndUpdate.mockResolvedValueOnce(null)
    expect(await store.updateJob('job1', { status: 'in_progress' }, { status: 'open' })).toBeNull()
  })
  it('rejects arbitrary MongoDB predicates in expected job conditions', async () => {
    mongo.findOne.mockResolvedValue(job())
    await expect(store.updateJob('job1', { title: 'Changed' }, { status: 'open', ...{ $where: 'synthetic' } })).rejects.toThrow(/expected job field/i)
    await expect(store.updateJob('job1', { title: 'Changed' }, { workerAddress: 'native-unverified' })).rejects.toThrow(/identity/i)
    expect(mongo.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('uses per-job atomic nested application changes and detects missing matches', async () => {
    mongo.findOne.mockResolvedValue({ ...job(), applications: [application()] })
    await store.addApplication(application())
    expect(mongo.updateOne.mock.calls[0][0]).toEqual({ _id: 'job1', status: 'open', assignmentMode: 'application',
      'applications.id': { $ne: 'app1' }, 'applications.applicantAddress': { $ne: worker } })
    await store.updateApplication('job1', 'app1', { status: 'accepted' })
    expect(mongo.updateOne.mock.calls[1][1].$set['applications.$.status']).toBe('accepted')
    mongo.updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })
    await expect(store.addApplication(application())).rejects.toThrow(/missing|already exists/i)
  })
  it('assigns applications atomically from the current MongoDB array and rejects stale assignments', async () => {
    mongo.findOne.mockResolvedValue({ ...job(), applications: [application()] })
    mongo.findOneAndUpdate.mockResolvedValue({ ...job(), applications: [{ ...application(), status: 'accepted' }], status: 'in_progress', workerAddress: worker })
    expect((await store.assignJob('job1', 'app1', client))?.workerAddress).toBe(worker)
    const [filter, pipeline] = mongo.findOneAndUpdate.mock.calls[0]
    expect(filter).toMatchObject({ _id: 'job1', clientAddress: client, status: 'open', workerAddress: '' })
    expect(filter.applications.$elemMatch).toEqual({ id: 'app1', applicantAddress: worker, status: 'pending' })
    expect(pipeline[0].$set.applications.$map.input).toBe('$applications')
    mongo.findOneAndUpdate.mockResolvedValueOnce(null)
    expect(await store.assignJob('job1', 'app1', client)).toBeNull()
    expect(await store.assignJob('job1', 'app1', worker)).toBeNull()
  })
  it('atomically bounds review count, transaction uniqueness, attempt numbering, and terminal failure', async () => {
    mongo.findOne.mockResolvedValue(job({ status: 'in_progress', workerAddress: worker }))
    const sub = { ...submission(), status: 'approved' as const, genlayerTxHash: 'tx1' }
    mongo.findOneAndUpdate.mockResolvedValue(job({ status: 'approved', workerAddress: worker, submissions: [sub] }))
    expect((await store.recordJobReview('job1', sub, 'approved', worker))?.status).toBe('approved')
    const [filter, pipeline] = mongo.findOneAndUpdate.mock.calls[0]
    expect(filter['submissions.id']).toEqual({ $ne: 'sub1' })
    expect(filter['submissions.genlayerTxHash']).toEqual({ $ne: 'tx1' })
    expect(filter.$expr.$lt[1]).toBe(3)
    expect(pipeline[0].$set.status.$cond[1]).toBe('rejected')
    expect(pipeline[0].$set.submissions.$concatArrays[1][0].$mergeObjects[1].attempt.$add[1]).toBe(1)
    mongo.findOne.mockResolvedValue(job({ status: 'approved', workerAddress: worker, submissions: [sub] }))
    expect((await store.recordJobReview('job1', { ...sub, id: 'different' }, 'approved', worker))?.submissions.length).toBe(1)
  })
  it('upserts one submission atomically and treats artifact text as literal data', async () => {
    mongo.findOne.mockResolvedValue(job())
    const artifact = { ...submission(), notes: '$notAnAggregationExpression' }
    await store.addSubmission(artifact)
    const [filter, pipeline] = mongo.updateOne.mock.calls[0]
    expect(filter).toEqual({ _id: 'job1' })
    expect(Array.isArray(pipeline)).toBe(true)
    expect(pipeline[0].$set.submissions.$concatArrays[1][0].$literal.notes).toBe(artifact.notes)
    expect(pipeline[0].$set.submissions.$concatArrays[0].$filter.cond.$ne[1]).toEqual({ $literal: 'sub1' })
  })
  it('normalizes profiles and scopes notification writes to recipient identity', async () => {
    await store.upsertProfile(profile())
    expect(mongo.replaceOne).toHaveBeenCalledWith({ _id: worker }, profile(), { upsert: true })
    await store.addNotification(notification())
    expect(mongo.insertOne).toHaveBeenCalledWith({ ...notification(), _id: 'note1' })
    await store.markNotificationRead('note1', worker)
    expect(mongo.updateOne).toHaveBeenCalledWith({ _id: 'note1', recipientAddress: worker }, { $set: { read: true } })
    await store.markAllNotificationsRead(worker)
    expect(mongo.updateMany).toHaveBeenCalledWith({ recipientAddress: worker }, { $set: { read: true } })
  })
  it('reads scoped jobs, nested applications, profiles, and notifications', async () => {
    mongo.toArray.mockResolvedValue([{ ...job(), workerAddress: worker, applications: [application()] }])
    expect((await store.getJobsByClient(client)).length).toBe(1)
    expect((await store.getJobsByWorker(worker)).length).toBe(1)
    expect((await store.getApplicationsByApplicant(worker)).length).toBe(1)
    mongo.findOne.mockResolvedValue(profile())
    expect((await store.getProfile(worker))?.address).toBe(worker)
    mongo.findOne.mockResolvedValue(null)
    expect(await store.getProfile(worker)).toBeNull()
    expect(await store.getJob('missing')).toBeNull()
    mongo.toArray.mockResolvedValue([profile()])
    expect((await store.getAllProfiles()).length).toBe(1)
    mongo.toArray.mockResolvedValue([notification()])
    expect((await store.getNotifications(worker)).length).toBe(1)
  })
  it('reports missing jobs or nested matches across MongoDB writes', async () => {
    mongo.findOne.mockResolvedValue(null)
    expect(await store.updateJob('missing', { title: 'No' })).toBeNull()
    await expect(store.addApplication(application())).rejects.toThrow(/missing/i)
    await expect(store.addSubmission(submission())).rejects.toThrow(/missing/i)
    mongo.findOne.mockResolvedValue(job())
    await expect(store.updateApplication('job1', 'missing', { status: 'accepted' })).rejects.toThrow(/missing/i)
    mongo.updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })
    await expect(store.addSubmission(submission())).rejects.toThrow(/missing/i)
    mongo.findOne.mockResolvedValue({ ...job(), applications: [application()] })
    mongo.updateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })
    await expect(store.updateApplication('job1', 'app1', { status: 'accepted' })).rejects.toThrow(/missing/i)
  })
  it('rejects mutation of a legacy MongoDB job', async () => {
    mongo.findOne.mockResolvedValue({ ...job(), clientAddress: 'tmLegacyClient' })
    await expect(store.updateJob('job1', { title: 'Changed' })).rejects.toThrow(/legacy.*read.only/i)
    expect(mongo.findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe('MongoDB connection configuration with a mocked driver', () => {
  it('validates URI and database configuration without contacting a server', async () => {
    const adapter = await vi.importActual<typeof import('../lib/mongodb')>('../lib/mongodb')
    expect(await adapter.getMongoDatabase()).toBeNull()
    vi.stubEnv('MONGODB_URI', 'invalid-uri')
    await expect(adapter.getMongoDatabase()).rejects.toThrow(/connection URI/i)
    vi.stubEnv('MONGODB_URI', 'mongodb://synthetic.invalid/zcashed')
    vi.stubEnv('MONGODB_DB', 'invalid/database')
    await expect(adapter.getMongoDatabase()).rejects.toThrow(/database name/i)
    expect(driver.construct).not.toHaveBeenCalled()
  })
  it('reuses a bounded pool for the same URI/database and enforces production TLS', async () => {
    const adapter = await vi.importActual<typeof import('../lib/mongodb')>('../lib/mongodb')
    vi.stubEnv('MONGODB_URI', 'mongodb://synthetic.invalid/zcashed')
    vi.stubEnv('NODE_ENV', 'production')
    await adapter.getMongoDatabase()
    await adapter.getMongoDatabase()
    expect(driver.construct).toHaveBeenCalledTimes(1)
    expect(driver.construct.mock.calls[0][1]).toMatchObject({ maxPoolSize: 10, tls: true, serverSelectionTimeoutMS: 5000 })
    expect(driver.db).toHaveBeenCalledWith('zcashed_test')
    vi.stubEnv('MONGODB_DB', 'different')
    await adapter.getMongoDatabase()
    expect(driver.construct).toHaveBeenCalledTimes(2)
  })
  it('clears a failed connection for a retry and returns a credential-free error', async () => {
    const adapter = await vi.importActual<typeof import('../lib/mongodb')>('../lib/mongodb')
    vi.stubEnv('MONGODB_URI', 'mongodb+srv://synthetic.invalid/zcashed')
    vi.stubEnv('MONGODB_DB', '')
    driver.connect.mockRejectedValueOnce(new Error('synthetic sensitive driver error'))
    await expect(adapter.getMongoDatabase()).rejects.toThrow('MongoDB connection failed; verify the server configuration')
    expect(driver.close).toHaveBeenCalledTimes(1)
    await adapter.getMongoDatabase()
    expect(driver.construct).toHaveBeenCalledTimes(2)
    expect(driver.db).toHaveBeenCalledWith('zcashed')
  })
  it('sanitizes constructor and cleanup failures as well as failed connections', async () => {
    const adapter = await vi.importActual<typeof import('../lib/mongodb')>('../lib/mongodb')
    vi.stubEnv('MONGODB_URI', 'mongodb://synthetic.invalid/zcashed')
    driver.construct.mockImplementationOnce(() => { throw new Error('synthetic private URI error') })
    await expect(adapter.getMongoDatabase()).rejects.toThrow('MongoDB connection failed; verify the server configuration')
    driver.connect.mockRejectedValueOnce(new Error('synthetic driver failure'))
    driver.close.mockRejectedValueOnce(new Error('synthetic cleanup failure'))
    await expect(adapter.getMongoDatabase()).rejects.toThrow('MongoDB connection and cleanup failed; verify the server configuration')
    await adapter.getMongoDatabase()
    expect(driver.construct).toHaveBeenCalledTimes(3)
  })
})
