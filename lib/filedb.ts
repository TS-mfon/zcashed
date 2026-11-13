import fs from 'fs'
import path from 'path'
import { Job, Profile, Application, Submission, Notification } from './types'

const DATA_DIR = path.join(process.cwd(), 'data')

interface DB {
  jobs: Job[]
  profiles: Profile[]
  notifications: Notification[]
}

function file(name: string) {
  return path.join(DATA_DIR, name)
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function read<T>(name: string, fallback: T): T {
  ensureDir()
  const p = file(name)
  if (!fs.existsSync(p)) return fallback
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function write<T>(name: string, data: T) {
  ensureDir()
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2))
}

// ---- Jobs (jobs.json holds applications + submissions inline) ----
export const fileJobs = {
  all(): Job[] {
    return read<Job[]>('jobs.json', []).map((j) => ({
      ...j,
      submissions: j.submissions ?? [],
      applications: j.applications ?? [],
      assignmentMode: j.assignmentMode ?? 'application',
    }))
  },
  get(id: string): Job | null {
    return this.all().find((j) => j.id === id) ?? null
  },
  save(job: Job) {
    const jobs = this.all()
    const idx = jobs.findIndex((j) => j.id === job.id)
    if (idx >= 0) jobs[idx] = job
    else jobs.unshift(job)
    write('jobs.json', jobs)
  },
  update(id: string, updates: Partial<Job>): Job | null {
    const jobs = this.all()
    const idx = jobs.findIndex((j) => j.id === id)
    if (idx < 0) return null
    jobs[idx] = { ...jobs[idx], ...updates, updatedAt: new Date().toISOString() }
    write('jobs.json', jobs)
    return jobs[idx]
  },
  addApplication(jobId: string, app: Application): Job | null {
    const jobs = this.all()
    const idx = jobs.findIndex((j) => j.id === jobId)
    if (idx < 0) return null
    jobs[idx].applications = jobs[idx].applications ?? []
    jobs[idx].applications.push(app)
    jobs[idx].updatedAt = new Date().toISOString()
    write('jobs.json', jobs)
    return jobs[idx]
  },
  updateApplication(jobId: string, appId: string, updates: Partial<Application>): Job | null {
    const jobs = this.all()
    const idx = jobs.findIndex((j) => j.id === jobId)
    if (idx < 0) return null
    const apps = jobs[idx].applications ?? []
    const aIdx = apps.findIndex((a) => a.id === appId)
    if (aIdx < 0) return null
    apps[aIdx] = { ...apps[aIdx], ...updates }
    jobs[idx].applications = apps
    jobs[idx].updatedAt = new Date().toISOString()
    write('jobs.json', jobs)
    return jobs[idx]
  },
  addSubmission(jobId: string, sub: Submission): Job | null {
    const jobs = this.all()
    const idx = jobs.findIndex((j) => j.id === jobId)
    if (idx < 0) return null
    jobs[idx].submissions = jobs[idx].submissions ?? []
    const sIdx = jobs[idx].submissions.findIndex((s) => s.id === sub.id)
    if (sIdx >= 0) jobs[idx].submissions[sIdx] = sub
    else jobs[idx].submissions.push(sub)
    jobs[idx].updatedAt = new Date().toISOString()
    write('jobs.json', jobs)
    return jobs[idx]
  },
}

// ---- Profiles ----
export const fileProfiles = {
  all(): Profile[] {
    return read<Profile[]>('profiles.json', [])
  },
  get(address: string): Profile | null {
    return this.all().find((p) => p.address === address) ?? null
  },
  upsert(profile: Profile): Profile {
    const profiles = this.all()
    const idx = profiles.findIndex((p) => p.address === profile.address)
    if (idx >= 0) profiles[idx] = { ...profiles[idx], ...profile }
    else profiles.unshift(profile)
    write('profiles.json', profiles)
    return profile
  },
}

// ---- Notifications ----
export const fileNotifications = {
  all(): Notification[] {
    return read<Notification[]>('notifications.json', [])
  },
  forUser(address: string): Notification[] {
    return this.all()
      .filter((n) => n.recipientAddress === address)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },
  add(n: Notification) {
    const all = this.all()
    all.unshift(n)
    write('notifications.json', all)
  },
  markRead(id: string) {
    const all = this.all()
    const idx = all.findIndex((n) => n.id === id)
    if (idx >= 0) {
      all[idx].read = true
      write('notifications.json', all)
    }
  },
  markAllRead(address: string) {
    const all = this.all()
    all.forEach((n) => {
      if (n.recipientAddress === address) n.read = true
    })
    write('notifications.json', all)
  },
}
