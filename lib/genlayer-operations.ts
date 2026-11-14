import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getMongoDatabase } from './mongodb'

export class GenLayerBusyError extends Error {}
export type OperationRecord = { address: string; hash?: string; dispatchToken?: string; pending: boolean; settled?: boolean }
type OperationJournal = Readonly<Record<string, OperationRecord>>
type OperationDocument = OperationRecord & { _id: string; kind: 'operation' }
type LeaseDocument = { _id: string; token: string; expiresAt: Date }
export type JobLease = LeaseDocument & { localFile?: string }
let journalMemory: Readonly<Record<string, OperationJournal>> = {}
let localLeases: Readonly<Record<string, JobLease>> = {}
const durableOptions = { readConcern: { level: 'majority' as const }, writeConcern: { w: 'majority' as const, j: true } }

function journalFile(): string {
  return path.join(process.env.ZCASHED_DATA_DIR || path.join(process.cwd(), 'data'), 'genlayer-operations.json')
}

function validateRecord(key: string, value: unknown): OperationRecord {
  const entry = value as OperationRecord | undefined
  if (!/^[0-9a-f]{64}$/.test(key) || !entry || !/^0x[0-9a-fA-F]{40}$/.test(entry.address) ||
      (entry.hash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(entry.hash)) || typeof entry.pending !== 'boolean' ||
      (entry.settled !== undefined && typeof entry.settled !== 'boolean') ||
      (entry.dispatchToken !== undefined && (typeof entry.dispatchToken !== 'string' || !/^[0-9a-f-]{36}$/.test(entry.dispatchToken))) ||
      (!entry.hash && !entry.dispatchToken)) throw new Error('The GenLayer recovery journal is invalid')
  return { address: entry.address.toLowerCase(), pending: entry.pending,
    ...(entry.hash !== undefined ? { hash: entry.hash } : {}),
    ...(entry.dispatchToken !== undefined ? { dispatchToken: entry.dispatchToken } : {}),
    ...(entry.settled !== undefined ? { settled: entry.settled } : {}) }
}

function readLocalJournal(): OperationJournal {
  const file = journalFile()
  if (journalMemory[file]) return journalMemory[file]
  let raw: string
  try { raw = fs.readFileSync(file, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('Could not read the local GenLayer recovery journal')
  }
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('The GenLayer recovery journal is invalid') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The GenLayer recovery journal is invalid')
  return Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, validateRecord(key, entry)]))
}

function saveLocalJournal(journal: OperationJournal): void {
  const file = journalFile()
  journalMemory = { ...journalMemory, [file]: journal }
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify(journal), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } catch { throw new Error('Could not persist the local GenLayer recovery journal; retry this operation') }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}

export async function readOperationJournal(): Promise<OperationJournal> {
  const database = await getMongoDatabase()
  if (!database) return readLocalJournal()
  const rows = await database.collection<OperationDocument>('genlayer_operations', durableOptions).find({ kind: 'operation' }).toArray()
  return Object.fromEntries(rows.map((row) => [row._id, validateRecord(row._id, row)]))
}

export async function reserveOperation(key: string, address: string): Promise<{ isNew: boolean; record: OperationRecord }> {
  const record = validateRecord(key, { address, dispatchToken: randomUUID(), pending: true, settled: false })
  const database = await getMongoDatabase()
  if (!database) {
    const journal = readLocalJournal()
    if (journal[key]) return { isNew: false, record: journal[key] }
    saveLocalJournal({ ...journal, [key]: record })
    return { isNew: true, record }
  }
  const collection = database.collection<OperationDocument>('genlayer_operations', durableOptions)
  try {
    const result = await collection.insertOne({ _id: key, kind: 'operation', ...record })
    if (!result.acknowledged) throw new Error('GenLayer dispatch reservation was not acknowledged')
    return { isNew: true, record }
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    const existing = await collection.findOne({ _id: key })
    if (!existing) throw new Error('GenLayer dispatch reservation could not be recovered')
    return { isNew: false, record: validateRecord(key, existing) }
  }
}

export async function attachOperationHash(key: string, dispatchToken: string, hash: string): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('GenLayer returned an invalid transaction hash')
  const database = await getMongoDatabase()
  if (!database) {
    const journal = readLocalJournal()
    if (journal[key]?.dispatchToken !== dispatchToken) throw new Error('GenLayer dispatch reservation owner changed')
    saveLocalJournal({ ...journal, [key]: { ...journal[key], hash } })
    return
  }
  const result = await database.collection<OperationDocument>('genlayer_operations', durableOptions).updateOne({ _id: key, dispatchToken }, { $set: { hash } })
  if (!result.acknowledged || result.matchedCount !== 1) throw new Error('GenLayer transaction hash could not be durably recorded; operator reconciliation is required')
}

export async function patchOperation(key: string, patch: { pending?: boolean; settled?: boolean }): Promise<void> {
  const database = await getMongoDatabase()
  if (!database) {
    const journal = readLocalJournal()
    if (!journal[key]) throw new Error('GenLayer operation is missing from the recovery journal')
    saveLocalJournal({ ...journal, [key]: { ...journal[key], ...patch } })
    return
  }
  const result = await database.collection<OperationDocument>('genlayer_operations', durableOptions).updateOne({ _id: key }, { $set: patch })
  if (!result.acknowledged || result.matchedCount !== 1) throw new Error('GenLayer operation update was not acknowledged')
}

export async function removeFailedOperation(key: string): Promise<void> {
  const database = await getMongoDatabase()
  if (!database) {
    saveLocalJournal(Object.fromEntries(Object.entries(readLocalJournal()).filter(([id]) => id !== key)))
    return
  }
  const result = await database.collection<OperationDocument>('genlayer_operations', durableOptions).deleteOne({ _id: key })
  if (!result.acknowledged) throw new Error('Failed GenLayer operation cleanup was not acknowledged')
}

export async function acquireJobLease(jobId: string, durationMs = 300_000): Promise<JobLease> {
  const lease: JobLease = { _id: 'lease:' + createHash('sha256').update(jobId).digest('hex'), token: randomUUID(), expiresAt: new Date(Date.now() + durationMs) }
  const database = await getMongoDatabase()
  if (!database) {
    const localFile = journalFile() + ':' + lease._id
    if (localLeases[localFile] && localLeases[localFile].expiresAt.getTime() > Date.now()) throw new GenLayerBusyError('A GenLayer operation is already in progress for this job. Retry after it finishes.')
    const owned = { ...lease, localFile }
    localLeases = { ...localLeases, [localFile]: owned }
    return owned
  }
  const collection = database.collection<LeaseDocument>('operation_locks', durableOptions)
  try {
    const result = await collection.insertOne(lease)
    if (!result.acknowledged) throw new Error('GenLayer job lock was not acknowledged')
    return lease
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    const reclaimed = await collection.findOneAndUpdate({ _id: lease._id, expiresAt: { $lte: new Date() } },
      { $set: { token: lease.token, expiresAt: lease.expiresAt } }, { returnDocument: 'after' })
    if (!reclaimed) throw new GenLayerBusyError('A GenLayer operation is already in progress for this job. Retry after it finishes.')
    return lease
  }
}

export async function releaseJobLease(lease: JobLease): Promise<void> {
  if (lease.localFile) {
    if (localLeases[lease.localFile]?.token === lease.token) localLeases = Object.fromEntries(Object.entries(localLeases).filter(([id]) => id !== lease.localFile))
    return
  }
  const database = await getMongoDatabase()
  if (!database) throw new Error('GenLayer shared job lock storage is unavailable')
  const result = await database.collection<LeaseDocument>('operation_locks', durableOptions).deleteOne({ _id: lease._id, token: lease.token })
  if (!result.acknowledged) throw new Error('GenLayer job lock release was not acknowledged')
}
