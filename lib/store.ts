import type { Db, Document, UpdateFilter } from 'mongodb'
import { getMongoDatabase, storageBackend } from './mongodb'
import { fileJobs, fileProfiles, fileNotifications, normalizeJob, normalizeProfile,
  normalizeApplication, normalizeSubmission, normalizeNotification, requireUserId,
  assertMutableJob, patchedJob, matchesExpectation, jobExpectation, assertOpenApplications,
  assignedJob, reviewedJob, type JobExpectation } from './filedb'
import type { Job, Profile, Application, Submission, Notification } from './types'

export { storageBackend }
export type { JobExpectation }
type JobDocument = Job & { _id: string }
type ProfileDocument = Profile & { _id: string }
type NotificationDocument = Notification & { _id: string }

async function database(): Promise<Db | null> {
  storageBackend()
  return getMongoDatabase()
}
async function mongoOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch { throw new Error('MongoDB storage operation failed: ' + operation) }
}
function acknowledged(result: { acknowledged: boolean }): void {
  if (!result.acknowledged) throw new Error('MongoDB did not acknowledge the storage write')
}
async function mongoJob(db: Db, id: string): Promise<Job | null> {
  const row = await mongoOperation('read job', () => db.collection<JobDocument>('jobs').findOne({ _id: id }))
  return row ? normalizeJob(row) : null
}
async function mutableJob(db: Db, id: string): Promise<Job> {
  const job = await mongoJob(db, id)
  if (!job) throw new Error('Job is missing')
  assertMutableJob(job)
  return job
}

export async function getAllJobs(): Promise<Job[]> {
  const db = await database()
  if (!db) return fileJobs.all()
  const rows = await mongoOperation('list jobs', () => db.collection<JobDocument>('jobs').find({}).sort({ createdAt: -1 }).toArray())
  return rows.map(normalizeJob)
}
export async function getJob(id: string): Promise<Job | null> {
  const db = await database()
  return db ? mongoJob(db, id) : fileJobs.get(id)
}
export async function createJob(value: Job): Promise<Job> {
  const job = normalizeJob(value)
  assertMutableJob(job)
  const db = await database()
  if (!db) { fileJobs.save(job); return job }
  const result = await mongoOperation('create job', () => db.collection<JobDocument>('jobs').insertOne({ ...job, _id: job.id }))
  acknowledged(result)
  return job
}
export async function updateJob(id: string, updates: Partial<Job>, expected?: JobExpectation): Promise<Job | null> {
  const conditions = jobExpectation(expected)
  const db = await database()
  if (!db) return fileJobs.update(id, updates, conditions)
  const current = await mongoJob(db, id)
  if (!current || !matchesExpectation(current, conditions)) return null
  const next = patchedJob(current, updates)
  const keys = Object.keys(updates).filter((key) => key !== 'id' && key !== 'clientAddress')
  const patch = Object.fromEntries(keys.filter((key) => Object.hasOwn(next, key)).map((key) => [key, next[key as keyof Job]]))
  const set = { ...patch, ...(updates.budgetZec !== undefined || updates.budgetZatoshis !== undefined ?
    { budgetZec: next.budgetZec, budgetZatoshis: next.budgetZatoshis } : {}), updatedAt: next.updatedAt }
  const result = await mongoOperation('update job', () => db.collection<JobDocument>('jobs').findOneAndUpdate(
    { _id: id, ...conditions }, { $set: set }, { returnDocument: 'after', includeResultMetadata: false }))
  return result ? normalizeJob(result) : null
}
export async function getJobsByClient(address: string): Promise<Job[]> {
  const db = await database()
  if (!db) return fileJobs.all().filter((job) => job.clientAddress === address)
  const rows = await mongoOperation('list client jobs', () => db.collection<JobDocument>('jobs').find({ clientAddress: address }).sort({ createdAt: -1 }).toArray())
  return rows.map(normalizeJob)
}
export async function getJobsByWorker(address: string): Promise<Job[]> {
  const db = await database()
  if (!db) return fileJobs.all().filter((job) => job.workerAddress === address)
  const rows = await mongoOperation('list worker jobs', () => db.collection<JobDocument>('jobs').find({ workerAddress: address }).sort({ createdAt: -1 }).toArray())
  return rows.map(normalizeJob)
}

export async function addApplication(value: Application): Promise<void> {
  const app = normalizeApplication(value)
  requireUserId(app.applicantAddress)
  const db = await database()
  if (!db) {
    if (!fileJobs.addApplication(app.jobId, app)) throw new Error('Job is missing')
    return
  }
  assertOpenApplications(await mutableJob(db, app.jobId))
  const result = await mongoOperation('add application', () => db.collection<JobDocument>('jobs').updateOne(
    { _id: app.jobId, status: 'open', assignmentMode: 'application', 'applications.id': { $ne: app.id }, 'applications.applicantAddress': { $ne: app.applicantAddress } },
    { $push: { applications: app }, $set: { updatedAt: new Date().toISOString() } }))
  acknowledged(result)
  if (result.matchedCount !== 1) throw new Error('Job is missing or application already exists')
}

export async function assignJob(id: string, applicationId: string, clientActor: string): Promise<Job | null> {
  requireUserId(clientActor)
  const db = await database()
  if (!db) return fileJobs.assign(id, applicationId, clientActor)
  const current = await mongoJob(db, id)
  if (!current) return null
  const next = assignedJob(current, applicationId, clientActor)
  if (!next) return null
  const pipeline: Document[] = [{ $set: { workerAddress: { $literal: next.workerAddress }, status: 'in_progress',
    updatedAt: { $literal: next.updatedAt }, applications: { $map: { input: '$applications', as: 'app',
      in: { $mergeObjects: ['$$app', { status: { $cond: [{ $eq: ['$$app.id', { $literal: applicationId }] }, 'accepted', 'rejected'] } }] } } } } }]
  const row = await mongoOperation('assign job', () => db.collection<JobDocument>('jobs').findOneAndUpdate(
    { _id: id, clientAddress: clientActor, workerAddress: '', status: 'open', assignmentMode: 'application',
      applications: { $elemMatch: { id: applicationId, applicantAddress: next.workerAddress, status: 'pending' } } },
    pipeline, { returnDocument: 'after', includeResultMetadata: false }))
  return row ? normalizeJob(row) : null
}
export async function recordJobReview(id: string, value: Submission, newStatus: Job['status'], workerActor: string): Promise<Job | null> {
  requireUserId(workerActor)
  const db = await database()
  if (!db) return fileJobs.recordReview(id, value, newStatus, workerActor)
  const current = await mongoJob(db, id)
  if (!current) return null
  const next = reviewedJob(current, value, newStatus, workerActor)
  if (!next || next === current) return next
  const sub = normalizeSubmission(value)
  const existing = { $ifNull: ['$submissions', []] }
  const terminal = { $and: [{ $ne: [{ $literal: newStatus }, 'approved'] }, { $gte: [{ $size: existing }, 2] }] }
  const pipeline: Document[] = [{ $set: { status: { $cond: [terminal, 'rejected', { $literal: newStatus }] }, updatedAt: { $literal: next.updatedAt },
    submissions: { $concatArrays: [existing, [{ $mergeObjects: [{ $literal: sub }, {
      attempt: { $add: [{ $size: existing }, 1] }, status: { $cond: [terminal, 'rejected', { $literal: sub.status }] },
    }] }]] } } }]
  const row = await mongoOperation('record review', () => db.collection<JobDocument>('jobs').findOneAndUpdate(
    { _id: id, workerAddress: workerActor, status: { $in: ['in_progress', 'needs_revision'] },
      'submissions.id': { $ne: sub.id }, 'submissions.genlayerTxHash': { $ne: sub.genlayerTxHash }, $expr: { $lt: [{ $size: existing }, 3] } }, pipeline,
    { returnDocument: 'after', includeResultMetadata: false }))
  if (row) return normalizeJob(row)
  const latest = await mongoJob(db, id)
  return latest?.submissions.some((entry) => entry.id === sub.id || entry.genlayerTxHash === sub.genlayerTxHash) ? reviewedJob(latest, sub, newStatus, workerActor) : null
}
export async function updateApplication(jobId: string, appId: string, updates: Partial<Application>): Promise<void> {
  const db = await database()
  if (!db) {
    if (!fileJobs.updateApplication(jobId, appId, updates)) throw new Error('Job is missing')
    return
  }
  const job = await mutableJob(db, jobId)
  const app = job.applications.find((entry) => entry.id === appId)
  if (!app) throw new Error('Application is missing')
  const next = normalizeApplication({ ...app, ...updates, id: appId, jobId, applicantAddress: app.applicantAddress })
  const set = Object.fromEntries(Object.keys(updates).filter((key) =>
    ['status', 'coverLetter', 'applicantName', 'proposedPrice'].includes(key)).map((key) => ['applications.$.' + key, next[key as keyof Application]]))
  const result = await mongoOperation('update application', () => db.collection<JobDocument>('jobs').updateOne(
    { _id: jobId, 'applications.id': appId }, { $set: { ...set, updatedAt: new Date().toISOString() } }))
  acknowledged(result)
  if (result.matchedCount !== 1) throw new Error('Application is missing')
}
export async function getApplicationsByApplicant(address: string): Promise<Application[]> {
  const db = await database()
  const jobs = db ? (await mongoOperation('list applications', () => db.collection<JobDocument>('jobs')
    .find({ 'applications.applicantAddress': address }).toArray())).map(normalizeJob) : fileJobs.all()
  return jobs.flatMap((job) => job.applications).filter((app) => app.applicantAddress === address)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function addSubmission(value: Submission): Promise<void> {
  const sub = normalizeSubmission(value)
  requireUserId(sub.workerAddress)
  const db = await database()
  if (!db) {
    if (!fileJobs.addSubmission(sub.jobId, sub)) throw new Error('Job is missing')
    return
  }
  await mutableJob(db, sub.jobId)
  // One atomic pipeline replaces only this ID and preserves concurrent submissions.
  const pipeline: Document[] = [{ $set: { submissions: { $concatArrays: [
    { $filter: { input: { $ifNull: ['$submissions', []] }, as: 'entry', cond: { $ne: ['$$entry.id', { $literal: sub.id }] } } },
    [{ $literal: sub }],
  ] }, updatedAt: { $literal: new Date().toISOString() } } }]
  const result = await mongoOperation('upsert submission', () => db.collection<JobDocument>('jobs').updateOne({ _id: sub.jobId }, pipeline))
  acknowledged(result)
  if (result.matchedCount !== 1) throw new Error('Job is missing')
}

export async function getProfile(address: string): Promise<Profile | null> {
  const db = await database()
  if (!db) return fileProfiles.get(address)
  const row = await mongoOperation('read profile', () => db.collection<ProfileDocument>('profiles').findOne({ _id: address }))
  return row ? normalizeProfile(row) : null
}
export async function upsertProfile(value: Profile): Promise<Profile> {
  const profile = normalizeProfile(value)
  requireUserId(profile.address)
  const db = await database()
  if (!db) return fileProfiles.upsert(profile)
  const result = await mongoOperation('upsert profile', () => db.collection<ProfileDocument>('profiles').replaceOne(
    { _id: profile.address }, profile, { upsert: true }))
  acknowledged(result)
  return profile
}
export async function getAllProfiles(): Promise<Profile[]> {
  const db = await database()
  if (!db) return fileProfiles.all()
  const rows = await mongoOperation('list profiles', () => db.collection<ProfileDocument>('profiles').find({}).sort({ createdAt: -1 }).toArray())
  return rows.map(normalizeProfile)
}

export async function addNotification(value: Notification): Promise<void> {
  const note = normalizeNotification(value)
  requireUserId(note.recipientAddress)
  const db = await database()
  if (!db) { fileNotifications.add(note); return }
  const result = await mongoOperation('create notification', () => db.collection<NotificationDocument>('notifications').insertOne({ ...note, _id: note.id }))
  acknowledged(result)
}
export async function getNotifications(address: string): Promise<Notification[]> {
  const db = await database()
  if (!db) return fileNotifications.forUser(address)
  const rows = await mongoOperation('list notifications', () => db.collection<NotificationDocument>('notifications')
    .find({ recipientAddress: address }).sort({ createdAt: -1 }).toArray())
  return rows.map(normalizeNotification)
}
export async function markNotificationRead(id: string, address: string): Promise<boolean> {
  requireUserId(address)
  const db = await database()
  if (!db) return fileNotifications.markRead(id, address)
  const result = await mongoOperation('mark notification read', () => db.collection<NotificationDocument>('notifications').updateOne(
    { _id: id, recipientAddress: address }, { $set: { read: true } }))
  acknowledged(result)
  return result.matchedCount === 1
}
export async function markAllNotificationsRead(address: string): Promise<void> {
  requireUserId(address)
  const db = await database()
  if (!db) { fileNotifications.markAllRead(address); return }
  const result = await mongoOperation('mark notifications read', () => db.collection<NotificationDocument>('notifications').updateMany(
    { recipientAddress: address }, { $set: { read: true } } as UpdateFilter<NotificationDocument>))
  acknowledged(result)
}
