import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import vectors from './fixtures/zcash-vectors.json'
import { deriveVaultAddress, verifyVaultDeposit, sendShieldedPayout, inspectPayout } from '../lib/zallet'

const account = '7af243cb-530d-4b3b-a898-c3a8cae50309'
const txid = 'ab'.repeat(32)
const reference = 'zcashed:v1:deposit:a6810708-2256-4d66-a29b-8747be7414d9'
// Published Orchard-only ZIP 316 receiver re-encoded with the testnet network padding.
const address = 'utest1nvzd4wf8mxnext5mze9rzqc8feq2wpv27fdl396yy5lwaq6q6f3q6tnzw2h2ujtsgn9mnvgf6w9u7d4aq2dpxtnxespwlhyzavz9jujt'
const synced = { node_tip: { height: 4000000, blockhash: '12'.repeat(32) }, wallet_tip: { height: 4000000, blockhash: '12'.repeat(32) }, fully_synced_height: 4000000, locked: false }
let replies: Record<string, unknown>
let requests: { method: string; params: unknown[] }[]

beforeEach(() => {
  vi.stubEnv('ZALLET_RPC_URL', 'http://127.0.0.1:28232')
  vi.stubEnv('ZALLET_RPC_USER', 'vault-user')
  vi.stubEnv('ZALLET_RPC_PASSWORD', 'test-rpc-password')
  vi.stubEnv('ZALLET_ACCOUNT_ID', account)
  replies = { getwalletstatus: synced, z_listunifiedreceivers: { orchard: address }, z_getaddressforaccount: { account_uuid: account, diversifier_index: 1234, receiver_types: ['orchard'], address },
    z_getbalanceforaccount: { pools: { orchard: { valueZat: 50000000 } }, minimum_confirmations: 1 } }
  requests = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const request = JSON.parse(options.body)
    requests = [...requests, request]
    const reply = replies[request.method]
    if (reply instanceof Error) throw reply
    return Response.json({ jsonrpc: '2.0', id: request.id, result: reply })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('verified Zallet beta.4 wallet boundary', () => {
  it('derives an Orchard-only address from the configured existing account without creating a seed', async () => {
    expect(await deriveVaultAddress(1234)).toEqual({ address, accountId: account, startHeight: 4000000 })
    expect(requests.find((entry) => entry.method === 'z_getaddressforaccount')?.params).toEqual([account, ['orchard'], 1234])
    expect(requests.some((entry) => /seed|newaccount|newwallet|export|import/.test(entry.method))).toBe(false)
  })
  it('fails closed without an authenticated wallet configuration', async () => {
    vi.stubEnv('ZALLET_RPC_PASSWORD', '')
    await expect(deriveVaultAddress(1234)).rejects.toThrow('configured')
    expect(requests).toEqual([])
  })
  it('fails closed for a mainnet address or a wallet still scanning', async () => {
    replies.z_getaddressforaccount = { account_uuid: account, diversifier_index: 1234, receiver_types: ['orchard'], address: vectors.orchardOnly }
    await expect(deriveVaultAddress(1234)).rejects.toThrow()
    replies.getwalletstatus = { ...synced, locked: true }
    await expect(deriveVaultAddress(1234)).rejects.toThrow('synced')
  })
  it('confirms only an exact wallet-decrypted receipt with the correct account, receiver, memo and integer amount', async () => {
    replies.z_listtransactions = [{ account_uuid: account, txid, mined_height: 4000000, outputs: [] }]
    replies.z_viewtransaction = { txid, status: 'mined', confirmations: 1, outputs: [{ pool: 'orchard', action: 0, account_uuid: account, address, outgoing: false, walletInternal: false, valueZat: 10000000, memoStr: reference, memo: Buffer.from(reference).toString('hex').padEnd(1024, '0') }] }
    expect(await verifyVaultDeposit({ address, reference, amountZatoshis: 10000000, startHeight: 3999999 })).toEqual({ txid, outputIndex: 0, amountZatoshis: 10000000, confirmations: 1 })
  })
  it.each([
    { confirmations: 0, status: 'waiting' },
    { outputs: [{ pool: 'orchard', action: 0, account_uuid: account, address, outgoing: false, walletInternal: false, valueZat: 9999999, memoStr: reference }] },
    { outputs: [{ pool: 'orchard', action: 0, account_uuid: account, address, outgoing: true, walletInternal: false, valueZat: 10000000, memoStr: reference }] },
    { outputs: [{ pool: 'orchard', action: 0, account_uuid: account, address, outgoing: false, walletInternal: false, valueZat: 10000000, memoStr: 'another-job' }] },
  ])('does not fund a job for incomplete or mismatched evidence: %j', async (change) => {
    replies.z_listtransactions = [{ account_uuid: account, txid, outputs: [] }]
    replies.z_viewtransaction = { txid, status: 'mined', confirmations: 1, outputs: [], ...change }
    expect(await verifyVaultDeposit({ address, reference, amountZatoshis: 10000000, startHeight: 3999999 })).toBeNull()
  })
  it('sends the full exact budget with an isolated Orchard source and FullPrivacy using the normative response', async () => {
    replies.z_sendfromaccount = { txid, txids: [txid], broadcast: true }
    expect(await sendShieldedPayout({ address, amountZatoshis: 17622195, memo: 'opaque-claim' })).toEqual({ txid, broadcast: true })
    expect(requests.find((entry) => entry.method === 'z_sendfromaccount')?.params).toEqual([account, 'orchard', [{ address, amount: '0.17622195', memo: '6f70617175652d636c61696d' }], 1, 'FullPrivacy'])
  })
  it('distinguishes a built but unbroadcast transaction and never retries a send whose response was lost', async () => {
    replies.z_sendfromaccount = { txid, txids: [txid], broadcast: false }
    expect(await sendShieldedPayout({ address, amountZatoshis: 10000000, memo: 'opaque-claim' })).toEqual({ txid, broadcast: false })
    replies.z_sendfromaccount = new Error('connection lost')
    await expect(sendShieldedPayout({ address, amountZatoshis: 10000000, memo: 'opaque-claim' })).rejects.toThrow('uncertain')
    expect(requests.filter((entry) => entry.method === 'z_sendfromaccount')).toHaveLength(2)
  })
  it('requires wallet confirmation of the actual outgoing payout before completion', async () => {
    replies.z_viewtransaction = { txid, status: 'waiting', confirmations: 0, outputs: [{ pool: 'orchard', action: 0, address, outgoing: true, walletInternal: false, valueZat: 10000000, memoStr: 'opaque-claim', memo: Buffer.from('opaque-claim').toString('hex').padEnd(1024, '0') }] }
    expect(await inspectPayout({ txid, address, amountZatoshis: 10000000, memo: 'opaque-claim' })).toEqual({ confirmed: false, confirmations: 0 })
    replies.z_viewtransaction = { ...(replies.z_viewtransaction as object), status: 'mined', confirmations: 2 }
    expect(await inspectPayout({ txid, address, amountZatoshis: 10000000, memo: 'opaque-claim' })).toEqual({ confirmed: true, confirmations: 2 })
  })
})
