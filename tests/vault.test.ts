import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Job } from '../lib/types'

const database = vi.hoisted(() => ({ rows: new Map<string, Map<string, Record<string, unknown>>>(), failClaimWrite: false, failInsertKind: '' }))
vi.mock('mongodb', () => ({ MongoClient: class {
  async connect() { return this }
  db() { return { collection(name: string) {
    const data = () => database.rows.get(name) ?? new Map<string, Record<string, unknown>>()
    const matches = (entry: Record<string, unknown>, filter: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => entry[key] === value)
    const evaluate = (value: unknown, entry: Record<string, unknown>, variables: Record<string, unknown> = {}): unknown => {
      if (typeof value === 'string' && value.startsWith('$')) {
        const path = value.slice(value.startsWith('$$') ? 2 : 1).split('.')
        return path.reduce<unknown>((result, part) => (result as Record<string, unknown>)?.[part], value.startsWith('$$') ? variables : entry)
      }
      if (Array.isArray(value)) return value.map((item) => evaluate(item, entry, variables))
      if (!value || typeof value !== 'object') return value
      const expression = value as Record<string, unknown>
      if ('$literal' in expression) return expression.$literal
      if ('$ifNull' in expression) { const values = evaluate(expression.$ifNull, entry, variables) as unknown[]; return values[0] ?? values[1] }
      if ('$concatArrays' in expression) return (evaluate(expression.$concatArrays, entry, variables) as unknown[][]).flat()
      if ('$ne' in expression) { const values = evaluate(expression.$ne, entry, variables) as unknown[]; return values[0] !== values[1] }
      if ('$filter' in expression) {
        const filter = expression.$filter as { input: unknown; as: string; cond: unknown }
        return (evaluate(filter.input, entry, variables) as unknown[]).filter((item) => evaluate(filter.cond, entry, { ...variables, [filter.as]: item }))
      }
      throw new Error('Unsupported MongoDB fixture expression')
    }
    return {
      async createIndex() { return 'index' },
      find(filter: Record<string, unknown>) { return { async toArray() { return [...data().values()].filter(entry => matches(entry, filter)) } } },
      async deleteOne(filter: Record<string, unknown>) {
        const entry = [...data().values()].find(entry => matches(entry, filter))
        if (!entry) return { acknowledged: true, deletedCount: 0 }
        database.rows = new Map([...database.rows, [name, new Map([...data()].filter(([key]) => key !== String(entry._id)))]])
        return { acknowledged: true, deletedCount: 1 }
      },
      async findOne(filter: Record<string, unknown>) { return [...data().values()].find((entry) => matches(entry, filter)) ?? null },
      async insertOne(entry: Record<string, unknown>) {
        if (entry.kind === database.failInsertKind) throw new Error('database disconnected')
        if (data().has(String(entry._id))) throw Object.assign(new Error('duplicate'), { code: 11000 })
        database.rows = new Map([...database.rows, [name, new Map([...data(), [String(entry._id), { ...entry }]])]])
        return { acknowledged: true }
      },
      async updateOne(filter: Record<string, unknown>, update: { $set: Record<string, unknown> } | { $set: Record<string, unknown> }[]) {
        if (!Array.isArray(update) && name === 'vault_operations' && database.failClaimWrite && update.$set.state === 'broadcast') throw new Error('database disconnected')
        const entry = [...data().values()].find((entry) => matches(entry, filter))
        if (!entry) return { acknowledged: true, matchedCount: 0 }
        const fields = Array.isArray(update) ? Object.fromEntries(Object.entries(update[0].$set).map(([key, value]) => [key, evaluate(value, entry)])) : update.$set
        database.rows = new Map([...database.rows, [name, new Map([...data(), [String(entry._id), { ...entry, ...fields }]])]])
        return { acknowledged: true, matchedCount: 1 }
      },
      async findOneAndUpdate(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
        const entry = [...data().values()].find((entry) => matches(entry, filter))
        if (!entry) return null
        const next = { ...entry, ...update.$set }
        database.rows = new Map([...database.rows, [name, new Map([...data(), [String(entry._id), next]])]])
        return next
      },
    }
  } } }
} }))

import { addSubmission, createJob, getJob, updateJob } from '../lib/store'
import { createJobVault, confirmJobFunding, claimJobPayment, refundJobPayment, getPrivateVaultOperation } from '../lib/vault'
import { POST as funding } from '../app/api/jobs/[id]/funding/route'
import { POST as claim, GET as claimStatus } from '../app/api/jobs/[id]/claim/route'
import { POST as refund } from '../app/api/jobs/[id]/refund/route'

const client = 'user_' + '1'.repeat(64)
const worker = 'user_' + '2'.repeat(64)
const stranger = 'user_' + '3'.repeat(64)
const account = '7af243cb-530d-4b3b-a898-c3a8cae50309'
const address = 'utest1nvzd4wf8mxnext5mze9rzqc8feq2wpv27fdl396yy5lwaq6q6f3q6tnzw2h2ujtsgn9mnvgf6w9u7d4aq2dpxtnxespwlhyzavz9jujt'
const depositTxid = 'ab'.repeat(32)
const payoutTxid = 'cd'.repeat(32)
let funded: boolean
let payoutConfirmed: boolean
let sendFails: boolean
let sends: number
let payoutMemo: string
let broadcastEnabled: boolean
let job: Job

function session(id: string) {
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'session', id, walletAddress: 'existing-testnet-signing-address', network: 'testnet', exp: Date.now() + 60000 })).toString('base64url')
  return payload + '.' + createHmac('sha256', process.env.SESSION_SECRET!).update(payload).digest('base64url')
}
function request(path: string, actor: string | null, body: unknown = {}, method = 'POST') {
  return new NextRequest('http://localhost/api/jobs/job1/' + path, { method, headers: actor ? { cookie: 'zcashed_session=' + session(actor), 'Content-Type': 'application/json' } : {},
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
}
const context = { params: Promise.resolve({ id: 'job1' }) }

beforeEach(async () => {
  vi.stubEnv('MONGODB_URI', 'mongodb://test-vault')
  vi.stubEnv('MONGODB_DB', 'vault_test')
  vi.stubEnv('ZALLET_RPC_URL', 'http://127.0.0.1:28232')
  vi.stubEnv('ZALLET_RPC_USER', 'test-user')
  vi.stubEnv('ZALLET_RPC_PASSWORD', 'test-rpc-password')
  vi.stubEnv('ZALLET_ACCOUNT_ID', account)
  database.rows = new Map()
  database.failClaimWrite = false
  database.failInsertKind = ''
  broadcastEnabled = true
  funded = false; payoutConfirmed = false; sendFails = false; sends = 0; payoutMemo = ''
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const rpc = JSON.parse(options.body)
    let result: unknown
    if (rpc.method === 'z_listunifiedreceivers') result = { orchard: rpc.params[0] }
    else if (rpc.method === 'getwalletstatus') result = { node_tip: { height: 4000000, blockhash: '12'.repeat(32) }, wallet_tip: { height: 4000000, blockhash: '12'.repeat(32) }, fully_synced_height: 4000000, locked: false }
    else if (rpc.method === 'z_getaddressforaccount') result = { account_uuid: account, diversifier_index: rpc.params[2], receiver_types: ['orchard'], address }
    else if (rpc.method === 'z_listtransactions') result = funded ? [{ account_uuid: account, txid: depositTxid, outputs: [] }] : []
    else if (rpc.method === 'z_getbalanceforaccount') result = { pools: { orchard: { valueZat: 50000000 } }, minimum_confirmations: 1 }
    else if (rpc.method === 'z_sendfromaccount') {
      sends++; payoutMemo = Buffer.from(rpc.params[2][0].memo, 'hex').toString('utf8')
      if (sendFails) throw new Error('response lost')
      result = { txid: payoutTxid, txids: [payoutTxid], broadcast: broadcastEnabled }
    } else if (rpc.method === 'z_viewtransaction') {
      const deposit = rpc.params[0] === depositTxid
      const memo = deposit ? job.vaultReference : payoutMemo
      result = { txid: rpc.params[0], status: deposit || payoutConfirmed ? 'mined' : 'waiting', confirmations: deposit || payoutConfirmed ? 1 : 0,
        outputs: [{ pool: 'orchard', action: 0, address, account_uuid: deposit ? account : undefined, outgoing: !deposit, walletInternal: false, valueZat: 10000000, memoStr: memo, memo: Buffer.from(memo).toString('hex').padEnd(1024, '0') }] }
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
  }))
  const vault = await createJobVault('job1')
  job = await createJob({ id: 'job1', title: 'Public work', description: 'Public acceptance requirement.', budgetZatoshis: 10000000, budgetZec: 0.1, assignmentMode: 'direct', category: 'Writing', clientAddress: client, workerAddress: '',
    vaultAddress: vault.address, vaultReference: vault.reference, vaultNetwork: vault.network, fundedAt: null, fundedZatoshis: 0,
    status: 'funding_required', genlayerContractAddress: '0x' + '4'.repeat(40), deadline: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), applications: [], submissions: [] })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function approve() {
  funded = true
  job = (await confirmJobFunding(job)).job
  await updateJob(job.id, { status: 'approved', workerAddress: worker })
  await addSubmission({ id: 'submission1', jobId: job.id, workerAddress: worker, submissionUrl: 'https://example.com/work', notes: '', status: 'approved', aiFeedback: 'Approved', attempt: 1, genlayerTxHash: '0x' + '9'.repeat(64), createdAt: new Date().toISOString() })
  job = (await getJob(job.id))!
}

describe('custodial job vault', () => {
  it('reuses a durable existing-account allocation and keeps the job closed until a confirmed exact receipt exists', async () => {
    expect(await createJobVault('job1')).toEqual({ address, reference: job.vaultReference, network: 'testnet' })
    expect((await confirmJobFunding(job)).job.status).toBe('funding_required')
    funded = true
    const receipt = await confirmJobFunding(job)
    expect(receipt.job).toMatchObject({ status: 'open', fundedZatoshis: 10000000 })
    expect(receipt.job.fundedAt).toBeTruthy()
    expect(JSON.stringify(receipt.job)).not.toContain(depositTxid)
  })
  it('allows only the session client to verify funding and rejects attacker-supplied transaction evidence', async () => {
    expect((await funding(request('funding', null), context)).status).toBe(401)
    expect((await funding(request('funding', worker), context)).status).toBe(403)
    expect((await funding(request('funding', client, { txid: depositTxid }), context)).status).toBe(400)
    expect((await getJob(job.id))?.status).toBe('funding_required')
  })
  it('prevents payouts for unfunded or unapproved work', async () => {
    await expect(claimJobPayment(job, address)).rejects.toThrow()
    expect(sends).toBe(0)
    expect((await claim(request('claim', worker, { payoutAddress: address }), context)).status).toBe(403)
  })
  it('reserves and broadcasts only once across concurrent claims, then completes only after wallet confirmation', async () => {
    await approve()
    const results = await Promise.all([claimJobPayment(job, address), claimJobPayment(job, address)])
    expect(sends).toBe(1)
    expect(results.some((result) => result.job.status === 'claiming')).toBe(true)
    expect((await getJob(job.id))?.status).toBe('claiming')
    payoutConfirmed = true
    const response = await claim(request('claim', worker, {}), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ job: { status: 'completed' }, operation: { state: 'confirmed', txid: payoutTxid } })
    expect(sends).toBe(1)
    expect(JSON.stringify(await getJob(job.id))).not.toContain(payoutTxid)
    expect(JSON.stringify(await getJob(job.id))).not.toContain(payoutMemo)
  })
  it('keeps a lost send response durably unknown and never automatically sends again', async () => {
    await approve(); sendFails = true
    const first = await claimJobPayment(job, address)
    expect(first.operation?.state).toBe('unknown')
    expect(first.job.status).toBe('claiming')
    const second = await claimJobPayment((await getJob(job.id))!, address)
    expect(second.operation?.state).toBe('unknown')
    expect(sends).toBe(1)
  })
  it('retains a known transaction after a metadata write failure without rebroadcasting', async () => {
    await approve(); database.failClaimWrite = true
    const result = await claimJobPayment(job, address)
    expect(result.operation).toMatchObject({ state: 'unknown', txid: payoutTxid })
    expect((await getPrivateVaultOperation(job.id))?.txid).toBe(payoutTxid)
    await claimJobPayment((await getJob(job.id))!, address)
    expect(sends).toBe(1)
  })
  it('keeps private payout metadata behind worker or client authorization', async () => {
    await approve(); await claimJobPayment(job, address)
    expect((await claimStatus(request('claim', stranger, {}, 'GET'), context)).status).toBe(403)
    expect((await claimStatus(request('claim', null, {}, 'GET'), context)).status).toBe(401)
    const clientResponse = await claimStatus(request('claim', client, {}, 'GET'), context)
    expect(clientResponse.status).toBe(200)
    expect(await clientResponse.json()).toMatchObject({ operation: { state: 'broadcast', txid: payoutTxid } })
    expect((await claim(request('claim', client, { payoutAddress: address }), context)).status).toBe(403)
  })
  it('rejects invalid identifiers, missing durable storage and changed account configuration', async () => {
    await expect(createJobVault('../invalid')).rejects.toThrow('identifier')
    vi.stubEnv('MONGODB_URI', '')
    await expect(createJobVault('job2')).rejects.toThrow('MongoDB')
    vi.stubEnv('MONGODB_URI', 'mongodb://test-vault')
    vi.stubEnv('ZALLET_ACCOUNT_ID', 'e7895a30-e60d-439a-b226-63748004b2fd')
    await expect(createJobVault('job1')).rejects.toThrow('configuration changed')
  })
  it('rejects altered vault references and jobs that are not awaiting funding', async () => {
    await expect(confirmJobFunding({ ...job, vaultReference: 'another-reference' })).rejects.toThrow('does not match')
    await expect(confirmJobFunding({ ...job, status: 'in_progress' })).rejects.toThrow('not awaiting')
  })
  it('handles simultaneous deposit checks without counting a receipt twice', async () => {
    funded = true
    const results = await Promise.allSettled([confirmJobFunding(job), confirmJobFunding(job)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await confirmJobFunding((await getJob(job.id))!)).toMatchObject({ received: true, job: { fundedZatoshis: 10000000 } })
  })
  it('requires the latest approved submission within three attempts and a valid payout address', async () => {
    await approve()
    await expect(claimJobPayment({ ...job, submissions: [] }, address)).rejects.toThrow('review')
    await expect(claimJobPayment({ ...job, submissions: [{ ...job.submissions[0], attempt: 4 }] }, address)).rejects.toThrow('three-attempt')
    await expect(claimJobPayment(job)).rejects.toThrow('payout address')
    await expect(claimJobPayment(job, 'utest1invalid')).rejects.toThrow('valid')
    expect(sends).toBe(0)
  })
  it('refuses a forged public funding flag without a private ledger receipt', async () => {
    const forged = { ...job, status: 'approved' as const, workerAddress: worker, fundedAt: new Date().toISOString(), fundedZatoshis: job.budgetZatoshis,
      submissions: [{ id: 'sub1', jobId: job.id, workerAddress: worker, submissionUrl: '', notes: '', status: 'approved' as const, aiFeedback: '', attempt: 1, genlayerTxHash: '0x' + '8'.repeat(64), createdAt: new Date().toISOString() }] }
    await expect(claimJobPayment(forged, address)).rejects.toThrow('private ledger')
    expect(sends).toBe(0)
  })
  it('rechecks funding at claim time so a removed deposit cannot authorize a send', async () => {
    await approve(); funded = false
    await expect(claimJobPayment(job, address)).rejects.toThrow('no longer confirms')
    expect(sends).toBe(0)
  })
  it('does not send when a durable claim reservation fails or the job changes before reservation', async () => {
    await approve(); database.failInsertKind = 'claim'
    await expect(claimJobPayment(job, address)).rejects.toThrow('reserved durably')
    expect(sends).toBe(0)
    database.failInsertKind = ''
    await updateJob(job.id, { status: 'cancelled' })
    await expect(claimJobPayment(job, address)).rejects.toThrow('changed while reserving')
    expect((await getPrivateVaultOperation(job.id))?.state).toBe('unknown')
    expect(sends).toBe(0)
  })
  it('keeps a built but unbroadcast payout pending and allows only confirmation checks', async () => {
    await approve(); broadcastEnabled = false
    const first = await claimJobPayment(job, address)
    expect(first.operation?.state).toBe('unbroadcast')
    const checked = await claimJobPayment((await getJob(job.id))!)
    expect(checked.job.status).toBe('claiming')
    expect(sends).toBe(1)
  })
  it('returns a confirmed payout to pending after a chain reorganization without resending', async () => {
    await approve(); await claimJobPayment(job, address); payoutConfirmed = true
    expect((await claimJobPayment((await getJob(job.id))!)).job.status).toBe('completed')
    payoutConfirmed = false
    const reorganized = await claimJobPayment((await getJob(job.id))!)
    expect(reorganized.job.status).toBe('claiming')
    expect(reorganized.operation).toMatchObject({ state: 'broadcast', confirmations: 0 })
    expect(sends).toBe(1)
  })
  it('returns cancelled job funds only to an explicit client-authorized shielded refund, confirmed by the wallet', async () => {
    funded = true; job = (await confirmJobFunding(job)).job
    job = (await updateJob(job.id, { status: 'cancelled' }))!
    expect((await refund(request('refund', worker, { refundAddress: address }), context)).status).toBe(403)
    expect((await refund(request('refund', null, { refundAddress: address }), context)).status).toBe(401)
    const started = await refund(request('refund', client, { refundAddress: address }), context)
    expect(started.status).toBe(202)
    expect(await started.json()).toMatchObject({ job: { status: 'refunding' }, operation: { purpose: 'client_refund', state: 'broadcast' } })
    payoutConfirmed = true
    const confirmed = await refund(request('refund', client, {}), context)
    expect(await confirmed.json()).toMatchObject({ job: { status: 'refunded' }, operation: { state: 'confirmed', txid: payoutTxid } })
    expect(sends).toBe(1)
  })
  it('refuses a client refund after work is approved or a worker payout has been reserved', async () => {
    await approve()
    expect((await refund(request('refund', client, { refundAddress: address }), context)).status).toBe(409)
    await claimJobPayment(job, address)
    await expect(refundJobPayment((await getJob(job.id))!, address)).rejects.toThrow('different release')
    expect(sends).toBe(1)
  })
  it('reserves rejected job refunds once and never retries a refund whose broadcast response is unknown', async () => {
    await approve(); job = (await updateJob(job.id, { status: 'rejected' }))!; sendFails = true
    const first = await refundJobPayment(job, address)
    expect(first).toMatchObject({ job: { status: 'refunding' }, operation: { purpose: 'client_refund', state: 'unknown' } })
    await refundJobPayment((await getJob(job.id))!, address)
    await expect(claimJobPayment((await getJob(job.id))!, address)).rejects.toThrow('different release')
    expect(sends).toBe(1)
  })
  it('recognizes a late deposit after cancellation without reopening the job so the client can refund it', async () => {
    job = (await updateJob(job.id, { status: 'cancelled' }))!; funded = true
    job = (await confirmJobFunding(job)).job
    expect(job).toMatchObject({ status: 'cancelled', fundedZatoshis: 10000000 })
    expect((await refundJobPayment(job, address)).job.status).toBe('refunding')
  })
})
