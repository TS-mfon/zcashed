import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Job, Profile, Application, Submission, Notification } from './types'

export type JobExpectation = Partial<Pick<Job, 'status' | 'workerAddress' | 'clientAddress'>>
const USER_ID = /^user_[0-9a-f]{64}$/
const LEGACY_ID = /^legacy_[0-9a-f]{24}$/
const MAX_ZATOSHIS = 21000000 * 100000000

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored record')
  return value as Record<string, unknown>
}
function text(row: Record<string, unknown>, key: string, fallback?: string): string {
  const value = row[key] ?? fallback
  if (typeof value !== 'string') throw new Error('Invalid stored field: ' + key)
  return value
}
function choice<T extends string>(value: unknown, choices: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Invalid stored status or role')
  return value as T
}
function actor(value: string): string {
  if (!value || USER_ID.test(value) || LEGACY_ID.test(value)) return value
  return 'legacy_' + createHash('sha256').update(value).digest('hex').slice(0, 24)
}
export function requireUserId(value: string): void {
  if (!USER_ID.test(value)) throw new Error('A verified session identity is required for storage writes')
}
function rows(value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid stored record list')
  return value
}
function budget(row: Record<string, unknown>): number {
  const exact = row.budgetZatoshis
  if (exact !== undefined) {
    if (!Number.isSafeInteger(exact) || Number(exact) < 1 || Number(exact) > MAX_ZATOSHIS) throw new Error('Invalid stored budget')
    return Number(exact)
  }
  const legacy = row.budgetZec
  if (typeof legacy !== 'number' || !Number.isFinite(legacy) || legacy <= 0 || legacy > 21000000) throw new Error('Invalid legacy budget')
  const scaled = legacy * 100000000
  const rounded = Math.round(scaled)
  if (!Number.isSafeInteger(rounded) || rounded < 1 || Math.abs(scaled - rounded) > 0.00001) throw new Error('Invalid legacy budget precision')
  return rounded
}
export function normalizeApplication(value: unknown): Application {
  const row = record(value)
  const price = row.proposedPrice ?? 0
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 21000000) throw new Error('Invalid stored proposed price')
  return { id: text(row, 'id'), jobId: text(row, 'jobId'), applicantAddress: actor(text(row, 'applicantAddress')),
    applicantName: text(row, 'applicantName', ''), coverLetter: text(row, 'coverLetter', ''), proposedPrice: price,
    status: choice(row.status, ['pending', 'accepted', 'rejected'] as const), createdAt: text(row, 'createdAt') }
}
export function normalizeSubmission(value: unknown): Submission {
  const row = record(value)
  const attempt = row.attempt ?? 1
  if (!Number.isSafeInteger(attempt) || Number(attempt) < 1) throw new Error('Invalid stored submission attempt')
  return { id: text(row, 'id'), jobId: text(row, 'jobId'), workerAddress: actor(text(row, 'workerAddress')),
    submissionUrl: text(row, 'submissionUrl', ''), notes: text(row, 'notes', ''),
    status: choice(row.status, ['pending', 'reviewing', 'approved', 'rejected', 'needs_revision', 'inconclusive'] as const),
    aiFeedback: text(row, 'aiFeedback', ''), attempt: Number(attempt), genlayerTxHash: text(row, 'genlayerTxHash', ''),
    createdAt: text(row, 'createdAt') }
}
export function normalizeJob(value: unknown): Job {
  const row = record(value)
  const amount = budget(row)
  const deadline = row.deadline ?? null
  const fundedAt = row.fundedAt ?? null
  const funded = row.fundedZatoshis ?? 0
  if (deadline !== null && typeof deadline !== 'string') throw new Error('Invalid stored deadline')
  if (fundedAt !== null && typeof fundedAt !== 'string') throw new Error('Invalid stored funding timestamp')
  if (!Number.isSafeInteger(funded) || Number(funded) < 0 || Number(funded) > MAX_ZATOSHIS) throw new Error('Invalid stored funded amount')
  return { id: text(row, 'id'), title: text(row, 'title'), description: text(row, 'description'),
    category: text(row, 'category', 'Other'), budgetZatoshis: amount, budgetZec: amount / 100000000,
    ...(row.reviewPolicy === undefined ? {} : { reviewPolicy: choice(row.reviewPolicy, ['public-text-v1'] as const) }),
    ...(row.deliverableKind === undefined ? {} : { deliverableKind: choice(row.deliverableKind, ['article', 'copy', 'translation', 'editing', 'summary'] as const) }),
    assignmentMode: choice(row.assignmentMode, ['direct', 'application'] as const, 'application'),
    clientAddress: actor(text(row, 'clientAddress')), workerAddress: actor(text(row, 'workerAddress', '')),
    ...(row.clientUsername === undefined ? {} : { clientUsername: text(row, 'clientUsername') }),
    ...(row.workerUsername === undefined ? {} : { workerUsername: text(row, 'workerUsername') }),
    vaultAddress: text(row, 'vaultAddress', ''), vaultReference: text(row, 'vaultReference', ''),
    vaultNetwork: choice(row.vaultNetwork, ['testnet'] as const, 'testnet'), fundedAt, fundedZatoshis: Number(funded),
    status: choice(row.status, ['funding_required', 'open', 'in_progress', 'under_review', 'needs_revision', 'approved', 'claiming', 'rejected', 'completed', 'cancelled', 'refunding', 'refunded'] as const),
    genlayerContractAddress: text(row, 'genlayerContractAddress', ''), deadline,
    ...(row.cancellationReason === undefined ? {} : { cancellationReason: choice(row.cancellationReason, ['client_cancelled', 'deadline_expired', 'unsupported_job'] as const) }),
    ...(row.cancelledAt === undefined ? {} : { cancelledAt: text(row, 'cancelledAt') }),
    createdAt: text(row, 'createdAt'), updatedAt: text(row, 'updatedAt'),
    applications: rows(row.applications).map(normalizeApplication), submissions: rows(row.submissions).map(normalizeSubmission) }
}
export function normalizeProfile(value: unknown): Profile {
  const row = record(value)
  const skills = rows(row.skills)
  if (!skills.every((skill) => typeof skill === 'string')) throw new Error('Invalid stored profile skills')
  const username = row.username
  if (username !== undefined && (typeof username !== 'string' || !/^[a-z0-9_]{3,24}$/.test(username))) throw new Error('Invalid stored username')
  return { address: actor(text(row, 'address')), displayName: text(row, 'displayName', ''),
    ...(username !== undefined ? { username: username as string } : {}),
    role: choice(row.role, ['client', 'freelancer', 'admin'] as const), bio: text(row, 'bio', ''),
    skills: skills.map(String), createdAt: text(row, 'createdAt') }
}
export function normalizeNotification(value: unknown): Notification {
  const row = record(value)
  if (typeof row.read !== 'boolean') throw new Error('Invalid stored notification read state')
  return { id: text(row, 'id'), recipientAddress: actor(text(row, 'recipientAddress')),
    type: choice(row.type, ['application_received', 'application_accepted', 'application_rejected', 'job_assigned',
      'work_submitted', 'work_approved', 'work_rejected', 'payment_released', 'job_completed', 'welcome'] as const),
    title: text(row, 'title'), body: text(row, 'body', ''), link: text(row, 'link', ''), read: row.read,
    createdAt: text(row, 'createdAt') }
}
export function assertMutableJob(job: Job): void {
  if (LEGACY_ID.test(job.clientAddress) || LEGACY_ID.test(job.workerAddress)) throw new Error('Legacy records are read-only; a scoped migration is required')
  requireUserId(job.clientAddress)
  if (job.workerAddress) requireUserId(job.workerAddress)
}
export function patchedJob(current: Job, updates: Partial<Job>): Job {
  assertMutableJob(current)
  if (updates.applications !== undefined || updates.submissions !== undefined) throw new Error('Use the dedicated nested storage APIs')
  if (updates.id !== undefined && updates.id !== current.id) throw new Error('Job identity is immutable')
  if (updates.clientAddress !== undefined && updates.clientAddress !== current.clientAddress) throw new Error('Job owner is immutable')
  const next = normalizeJob({ ...current, ...updates, id: current.id, clientAddress: current.clientAddress,
    budgetZatoshis: updates.budgetZatoshis ?? (updates.budgetZec !== undefined ? undefined : current.budgetZatoshis),
    updatedAt: new Date().toISOString() })
  assertMutableJob(next)
  return next
}
export function jobExpectation(expected: JobExpectation = {}): JobExpectation {
  const entries = Object.entries(expected).filter(([, value]) => value !== undefined)
  for (const [key, value] of entries) {
    if (!['status', 'workerAddress', 'clientAddress'].includes(key)) throw new Error('Invalid expected job field')
    if (key === 'status') choice(value, ['funding_required', 'open', 'in_progress', 'under_review', 'needs_revision', 'approved', 'claiming', 'rejected', 'completed', 'cancelled', 'refunding', 'refunded'] as const)
    else if (typeof value !== 'string') throw new Error('Invalid expected job identity')
    else if (key === 'clientAddress' || value !== '') requireUserId(value)
  }
  return Object.fromEntries(entries)
}
export function matchesExpectation(job: Job, expected?: JobExpectation): boolean {
  return Object.entries(jobExpectation(expected)).every(([key, value]) => job[key as keyof JobExpectation] === value)
}
export function assertOpenApplications(job: Job): void {
  if (job.status !== 'open' || job.assignmentMode !== 'application') throw new Error('An open application job is required')
}
export function assignedJob(current: Job, applicationId: string, clientActor: string): Job | null {
  requireUserId(clientActor)
  if (current.clientAddress !== clientActor || current.status !== 'open' || current.workerAddress || current.assignmentMode !== 'application') return null
  const chosen = current.applications.find((app) => app.id === applicationId && app.status === 'pending')
  if (!chosen) return null
  requireUserId(chosen.applicantAddress)
  return { ...current, workerAddress: chosen.applicantAddress, status: 'in_progress', updatedAt: new Date().toISOString(),
    applications: current.applications.map((app) => ({ ...app, status: app.id === applicationId ? 'accepted' : 'rejected' })) }
}
export function reviewedJob(current: Job, value: Submission, newStatus: Job['status'], workerActor: string): Job | null {
  requireUserId(workerActor)
  if (current.workerAddress !== workerActor) return null
  const sub = normalizeSubmission(value)
  if (sub.workerAddress !== workerActor || sub.jobId !== current.id) throw new Error('Submission does not match the assigned worker and job')
  const existing = current.submissions.find((entry) => entry.id === sub.id || (sub.genlayerTxHash && entry.genlayerTxHash === sub.genlayerTxHash))
  if (existing) {
    if (existing.workerAddress !== sub.workerAddress || existing.notes !== sub.notes || existing.submissionUrl !== sub.submissionUrl || existing.genlayerTxHash !== sub.genlayerTxHash) {
      throw new Error('Existing submission does not match the finalized artifact')
    }
    return current
  }
  if (!['in_progress', 'needs_revision'].includes(current.status) || current.submissions.length >= 3) return null
  if (!sub.id || !sub.genlayerTxHash || !['approved', 'needs_revision', 'rejected'].includes(newStatus)) throw new Error('A finalized review result is required')
  if (newStatus === 'approved' ? sub.status !== 'approved' : newStatus === 'rejected' ? sub.status !== 'rejected' : !['needs_revision', 'inconclusive', 'rejected'].includes(sub.status)) {
    throw new Error('Submission verdict does not match job review status')
  }
  assertMutableJob(current)
  const terminal = current.submissions.length === 2 && newStatus !== 'approved'
  return { ...current, status: terminal ? 'rejected' : newStatus,
    submissions: [...current.submissions, { ...sub, status: terminal ? 'rejected' : sub.status, attempt: current.submissions.length + 1 }], updatedAt: new Date().toISOString() }
}
function dataFile(name: string): string {
  return path.join(/* turbopackIgnore: true */ process.env.ZCASHED_DATA_DIR || path.join(process.cwd(), 'data'), name)
}
function readRows(name: string): unknown[] {
  let contents: string
  try { contents = fs.readFileSync(/* turbopackIgnore: true */ dataFile(name), 'utf8') }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Could not read local storage: ' + name)
  }
  try {
    const parsed: unknown = JSON.parse(contents)
    if (!Array.isArray(parsed)) throw new Error('Invalid list')
    return parsed
  } catch { throw new Error('Corrupt or invalid local storage: ' + name) }
}
function writeRows(name: string, data: unknown[]): void {
  const filename = dataFile(name)
  const temporary = filename + '.' + randomUUID() + '.tmp'
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, filename)
  } catch { throw new Error('Could not write local storage: ' + name) }
  finally { fs.rmSync(temporary, { force: true }) }
}
function changeJob(id: string, change: (job: Job) => Job, expected?: JobExpectation): Job | null {
  const all = fileJobs.all()
  const current = all.find((job) => job.id === id)
  if (!current || !matchesExpectation(current, expected)) return null
  assertMutableJob(current)
  const next = change(current)
  writeRows('jobs.json', all.map((job) => job.id === id ? next : job))
  return next
}

export const fileJobs = {
  all(): Job[] { return readRows('jobs.json').map(normalizeJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
  get(id: string): Job | null { return this.all().find((job) => job.id === id) ?? null },
  save(value: Job): void {
    const next = normalizeJob(value)
    assertMutableJob(next)
    const all = this.all()
    if (all.some((job) => job.id === next.id)) throw new Error('Job already exists')
    writeRows('jobs.json', [next, ...all])
  },
  update(id: string, updates: Partial<Job>, expected?: JobExpectation): Job | null {
    return changeJob(id, (current) => patchedJob(current, updates), expected)
  },
  addApplication(jobId: string, value: Application): Job | null {
    const app = normalizeApplication(value)
    requireUserId(app.applicantAddress)
    if (app.jobId !== jobId) throw new Error('Application does not match job')
    return changeJob(jobId, (current) => {
      assertOpenApplications(current)
      if (current.applications.some((item) => item.id === app.id || item.applicantAddress === app.applicantAddress)) throw new Error('Application already exists')
      return { ...current, applications: [...current.applications, app], updatedAt: new Date().toISOString() }
    })
  },
  updateApplication(jobId: string, appId: string, updates: Partial<Application>): Job | null {
    return changeJob(jobId, (current) => {
      const app = current.applications.find((item) => item.id === appId)
      if (!app) throw new Error('Application is missing')
      const next = normalizeApplication({ ...app, ...updates, id: app.id, jobId, applicantAddress: app.applicantAddress })
      return { ...current, applications: current.applications.map((item) => item.id === appId ? next : item), updatedAt: new Date().toISOString() }
    })
  },
  addSubmission(jobId: string, value: Submission): Job | null {
    const sub = normalizeSubmission(value)
    requireUserId(sub.workerAddress)
    if (sub.jobId !== jobId) throw new Error('Submission does not match job')
    return changeJob(jobId, (current) => ({ ...current,
      submissions: [...current.submissions.filter((item) => item.id !== sub.id), sub], updatedAt: new Date().toISOString() }))
  },
  assign(id: string, applicationId: string, clientActor: string): Job | null {
    const current = this.get(id)
    if (!current) return null
    const next = assignedJob(current, applicationId, clientActor)
    return next ? changeJob(id, () => next, { status: 'open', workerAddress: '', clientAddress: clientActor }) : null
  },
  recordReview(id: string, sub: Submission, newStatus: Job['status'], workerActor: string): Job | null {
    const current = this.get(id)
    if (!current) return null
    const next = reviewedJob(current, sub, newStatus, workerActor)
    if (!next || next === current) return next
    return changeJob(id, () => next, { status: current.status, workerAddress: workerActor })
  },
}
export const fileProfiles = {
  all(): Profile[] { return readRows('profiles.json').map(normalizeProfile).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
  get(address: string): Profile | null { return this.all().find((profile) => profile.address === address) ?? null },
  upsert(value: Profile): Profile {
    const next = normalizeProfile(value)
    requireUserId(next.address)
    const all = this.all()
    writeRows('profiles.json', [next, ...all.filter((profile) => profile.address !== next.address)])
    return next
  },
}
export const fileNotifications = {
  all(): Notification[] { return readRows('notifications.json').map(normalizeNotification) },
  forUser(address: string): Notification[] {
    return this.all().filter((note) => note.recipientAddress === address).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },
  add(value: Notification): void {
    const next = normalizeNotification(value)
    requireUserId(next.recipientAddress)
    const all = this.all()
    if (all.some((note) => note.id === next.id)) throw new Error('Notification already exists')
    writeRows('notifications.json', [next, ...all])
  },
  markRead(id: string, address: string): boolean {
    requireUserId(address)
    const all = this.all()
    if (!all.some((note) => note.id === id && note.recipientAddress === address)) return false
    writeRows('notifications.json', all.map((note) => note.id === id && note.recipientAddress === address ? { ...note, read: true } : note))
    return true
  },
  markAllRead(address: string): void {
    requireUserId(address)
    writeRows('notifications.json', this.all().map((note) => note.recipientAddress === address ? { ...note, read: true } : note))
  },
}
