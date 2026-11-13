import { getSupabase, hasSupabase } from './supabase'
import { fileJobs, fileProfiles, fileNotifications } from './filedb'
import {
  Job,
  Profile,
  Application,
  Submission,
  Notification,
} from './types'

// ---------- Row mappers (Supabase snake_case <-> camelCase) ----------
function jobFromRow(r: any, apps: Application[] = [], subs: Submission[] = []): Job {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    budgetZec: Number(r.budget_zec),
    assignmentMode: r.assignment_mode,
    clientAddress: r.client_address,
    escrowAddress: r.escrow_address,
    escrowPrivKey: r.escrow_privkey,
    workerAddress: r.worker_address ?? '',
    status: r.status,
    genlayerContractAddress: r.genlayer_contract_address ?? '',
    deadline: r.deadline,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    applications: apps,
    submissions: subs,
  }
}
function jobToRow(j: Partial<Job>): any {
  const row: any = {}
  if (j.id !== undefined) row.id = j.id
  if (j.title !== undefined) row.title = j.title
  if (j.description !== undefined) row.description = j.description
  if (j.category !== undefined) row.category = j.category
  if (j.budgetZec !== undefined) row.budget_zec = j.budgetZec
  if (j.assignmentMode !== undefined) row.assignment_mode = j.assignmentMode
  if (j.clientAddress !== undefined) row.client_address = j.clientAddress
  if (j.escrowAddress !== undefined) row.escrow_address = j.escrowAddress
  if (j.escrowPrivKey !== undefined) row.escrow_privkey = j.escrowPrivKey
  if (j.workerAddress !== undefined) row.worker_address = j.workerAddress
  if (j.status !== undefined) row.status = j.status
  if (j.genlayerContractAddress !== undefined) row.genlayer_contract_address = j.genlayerContractAddress
  if (j.deadline !== undefined) row.deadline = j.deadline
  if (j.createdAt !== undefined) row.created_at = j.createdAt
  if (j.updatedAt !== undefined) row.updated_at = j.updatedAt
  return row
}
function appFromRow(r: any): Application {
  return {
    id: r.id,
    jobId: r.job_id,
    applicantAddress: r.applicant_address,
    applicantName: r.applicant_name ?? '',
    coverLetter: r.cover_letter ?? '',
    proposedPrice: Number(r.proposed_price ?? 0),
    status: r.status,
    createdAt: r.created_at,
  }
}
function subFromRow(r: any): Submission {
  return {
    id: r.id,
    jobId: r.job_id,
    workerAddress: r.worker_address,
    submissionUrl: r.submission_url,
    notes: r.notes ?? '',
    status: r.status,
    aiFeedback: r.ai_feedback ?? '',
    attempt: r.attempt ?? 1,
    genlayerTxHash: r.genlayer_tx_hash ?? '',
    createdAt: r.created_at,
  }
}
function notifFromRow(r: any): Notification {
  return {
    id: r.id,
    recipientAddress: r.recipient_address,
    type: r.type,
    title: r.title,
    body: r.body ?? '',
    link: r.link ?? '',
    read: r.read,
    createdAt: r.created_at,
  }
}
function profFromRow(r: any): Profile {
  return {
    address: r.address,
    displayName: r.display_name ?? '',
    role: r.role,
    bio: r.bio ?? '',
    skills: r.skills ?? [],
    createdAt: r.created_at,
  }
}

async function hydrateJob(sb: any, row: any): Promise<Job> {
  const [{ data: apps }, { data: subs }] = await Promise.all([
    sb.from('applications').select('*').eq('job_id', row.id),
    sb.from('submissions').select('*').eq('job_id', row.id),
  ])
  return jobFromRow(
    row,
    (apps ?? []).map(appFromRow),
    (subs ?? []).map(subFromRow),
  )
}

// ============================ JOBS ============================
export async function getAllJobs(): Promise<Job[]> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('jobs').select('*').order('created_at', { ascending: false })
    return Promise.all((data ?? []).map((r) => hydrateJob(sb, r)))
  }
  return fileJobs.all()
}

export async function getJob(id: string): Promise<Job | null> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('jobs').select('*').eq('id', id).maybeSingle()
    if (!data) return null
    return hydrateJob(sb, data)
  }
  return fileJobs.get(id)
}

export async function createJob(job: Job): Promise<Job> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('jobs').insert(jobToRow(job))
    return job
  }
  fileJobs.save(job)
  return job
}

export async function updateJob(id: string, updates: Partial<Job>): Promise<Job | null> {
  const sb = getSupabase()
  if (sb) {
    const row = jobToRow(updates)
    row.updated_at = new Date().toISOString()
    await sb.from('jobs').update(row).eq('id', id)
    return getJob(id)
  }
  return fileJobs.update(id, updates)
}

export async function getJobsByClient(address: string): Promise<Job[]> {
  return (await getAllJobs()).filter((j) => j.clientAddress === address)
}

export async function getJobsByWorker(address: string): Promise<Job[]> {
  return (await getAllJobs()).filter((j) => j.workerAddress === address)
}

// ============================ APPLICATIONS ============================
export async function addApplication(app: Application): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('applications').insert({
      id: app.id,
      job_id: app.jobId,
      applicant_address: app.applicantAddress,
      applicant_name: app.applicantName,
      cover_letter: app.coverLetter,
      proposed_price: app.proposedPrice,
      status: app.status,
      created_at: app.createdAt,
    })
    return
  }
  fileJobs.addApplication(app.jobId, app)
}

export async function updateApplication(
  jobId: string,
  appId: string,
  updates: Partial<Application>,
): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    const row: any = {}
    if (updates.status !== undefined) row.status = updates.status
    await sb.from('applications').update(row).eq('id', appId)
    return
  }
  fileJobs.updateApplication(jobId, appId, updates)
}

export async function getApplicationsByApplicant(address: string): Promise<Application[]> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb
      .from('applications')
      .select('*')
      .eq('applicant_address', address)
      .order('created_at', { ascending: false })
    return (data ?? []).map(appFromRow)
  }
  const jobs = fileJobs.all()
  return jobs
    .flatMap((j) => j.applications ?? [])
    .filter((a) => a.applicantAddress === address)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ============================ SUBMISSIONS ============================
export async function addSubmission(sub: Submission): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('submissions').upsert({
      id: sub.id,
      job_id: sub.jobId,
      worker_address: sub.workerAddress,
      submission_url: sub.submissionUrl,
      notes: sub.notes,
      status: sub.status,
      ai_feedback: sub.aiFeedback,
      attempt: sub.attempt,
      genlayer_tx_hash: sub.genlayerTxHash,
      created_at: sub.createdAt,
    })
    return
  }
  fileJobs.addSubmission(sub.jobId, sub)
}

// ============================ PROFILES ============================
export async function getProfile(address: string): Promise<Profile | null> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('profiles').select('*').eq('address', address).maybeSingle()
    return data ? profFromRow(data) : null
  }
  return fileProfiles.get(address)
}

export async function upsertProfile(profile: Profile): Promise<Profile> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('profiles').upsert({
      address: profile.address,
      display_name: profile.displayName,
      role: profile.role,
      bio: profile.bio,
      skills: profile.skills,
      created_at: profile.createdAt,
    })
    return profile
  }
  return fileProfiles.upsert(profile)
}

export async function getAllProfiles(): Promise<Profile[]> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false })
    return (data ?? []).map(profFromRow)
  }
  return fileProfiles.all()
}

// ============================ NOTIFICATIONS ============================
export async function addNotification(n: Notification): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('notifications').insert({
      id: n.id,
      recipient_address: n.recipientAddress,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      read: n.read,
      created_at: n.createdAt,
    })
    return
  }
  fileNotifications.add(n)
}

export async function getNotifications(address: string): Promise<Notification[]> {
  const sb = getSupabase()
  if (sb) {
    const { data } = await sb
      .from('notifications')
      .select('*')
      .eq('recipient_address', address)
      .order('created_at', { ascending: false })
    return (data ?? []).map(notifFromRow)
  }
  return fileNotifications.forUser(address)
}

export async function markNotificationRead(id: string): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('notifications').update({ read: true }).eq('id', id)
    return
  }
  fileNotifications.markRead(id)
}

export async function markAllNotificationsRead(address: string): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    await sb.from('notifications').update({ read: true }).eq('recipient_address', address)
    return
  }
  fileNotifications.markAllRead(address)
}

export { hasSupabase }
