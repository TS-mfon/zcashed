import { formatZatoshis, MAX_ZATOSHIS, parseShieldedAddress } from './zcash'
import { zingoConfiguration, deriveZingoVaultAddress, verifyZingoDeposit, prepareZingoPayout, sendZingoPayout, inspectZingoPayout } from './zingo'

// Verified against Zallet v0.1.0-beta.4, not the legacy zcashd RPC schemas.
// https://github.com/zcash/zallet/tree/v0.1.0-beta.4/zallet-core/src/components/json_rpc
const TESTNET_NETWORK_PROBE = 'utest1nvzd4wf8mxnext5mze9rzqc8feq2wpv27fdl396yy5lwaq6q6f3q6tnzw2h2ujtsgn9mnvgf6w9u7d4aq2dpxtnxespwlhyzavz9jujt'
// Orchard receiver from the published ZIP 316 vector, encoded for testnet.
// Used only to ask the wallet's Rust decoder about its network.
// This address is never a payment destination.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TXID = /^[0-9a-f]{64}$/i
type Row = Record<string, unknown>

export class ZalletError extends Error {
  readonly status = 503
}
export class ZalletSendUncertainError extends ZalletError {
  constructor() { super('Payout broadcast is uncertain. The server will not resend; the operator must reconcile the wallet.') }
}

export function zalletConfiguration() {
  if (process.env.ZINGO_RPC_URL) return zingoConfiguration()
  const rpcUrl = process.env.ZALLET_RPC_URL?.trim()
  const user = process.env.ZALLET_RPC_USER
  const password = process.env.ZALLET_RPC_PASSWORD
  const accountId = process.env.ZALLET_ACCOUNT_ID?.trim()
  if (!rpcUrl || !user || !password || !accountId || !UUID.test(accountId)) {
    throw new ZalletError('The custodial testnet vault is not configured with an existing authenticated Zallet account.')
  }
  let url: URL
  try { url = new URL(rpcUrl) } catch { throw new ZalletError('Zallet RPC URL is invalid.') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new ZalletError('Zallet RPC requires HTTPS or loopback HTTP, with credentials supplied separately.')
  }
  return { url: url.toString(), accountId: accountId.toLowerCase(), authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64') }
}

function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ZalletError('Unsupported Zallet ' + label + ' response.')
  return value as Row
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
function amount(value: number): void {
  if (!integer(value, 1) || value > MAX_ZATOSHIS) throw new ZalletError('Invalid integer payout budget.')
}
function transactionId(value: unknown): string {
  if (typeof value !== 'string' || !TXID.test(value)) throw new ZalletError('Unsupported Zallet transaction identifier.')
  return value.toLowerCase()
}

async function rpc(method: string, params: unknown[], sending = false): Promise<unknown> {
  const configuration = zalletConfiguration()
  const id = crypto.randomUUID()
  try {
    const response = await fetch(configuration.url, {
      method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: configuration.authorization },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(sending ? 90000 : 10000),
    })
    if (!response.ok) throw new ZalletError('Zallet wallet RPC is unavailable.')
    const envelope = row(await response.json(), 'RPC')
    if (envelope.id !== id || envelope.error || !Object.hasOwn(envelope, 'result')) {
      throw new ZalletError('Zallet rejected ' + method + '; verify the beta.4 wallet configuration.')
    }
    return envelope.result
  } catch (cause) {
    // A failed synchronous send can have broadcast before the HTTP response was lost.
    if (sending) throw new ZalletSendUncertainError()
    if (cause instanceof ZalletError) throw cause
    throw new ZalletError('Zallet wallet RPC is unavailable; no wallet evidence was verified.')
  }
}

async function orchardReceiver(address: string): Promise<string> {
  const recipient = parseShieldedAddress(address, 'testnet')
  if (!recipient.address.startsWith('utest1') || recipient.pools.length !== 1 || recipient.preferredPool !== 'orchard') {
    throw new ZalletError('Use an Orchard-only testnet Unified Address.')
  }
  // This RPC uses librustzcash UnifiedAddress::decode(wallet.params(), address),
  // so wrong-network addresses fail at the actual wallet boundary as well.
  const receivers = row(await rpc('z_listunifiedreceivers', [recipient.address]), 'receivers')
  if (receivers.orchard !== recipient.address || Object.keys(receivers).some((key) => key !== 'orchard')) {
    throw new ZalletError('The wallet did not verify an Orchard-only testnet receiver.')
  }
  return recipient.address
}

async function syncedWallet(): Promise<number> {
  await orchardReceiver(TESTNET_NETWORK_PROBE)
  const status = row(await rpc('getwalletstatus', []), 'status')
  const node = row(status.node_tip, 'node tip')
  const wallet = row(status.wallet_tip, 'wallet tip')
  if (status.locked !== false || status.sync_work_remaining !== undefined || !integer(node.height, 1) ||
      wallet.height !== node.height || status.fully_synced_height !== node.height ||
      typeof node.blockhash !== 'string' || !TXID.test(node.blockhash) || wallet.blockhash !== node.blockhash) {
    throw new ZalletError('The testnet wallet must be fully synced before a vault operation.')
  }
  return node.height
}

export async function deriveVaultAddress(diversifierIndex: number): Promise<{ address: string; accountId: string; startHeight: number }> {
  if (process.env.ZINGO_RPC_URL) return deriveZingoVaultAddress(diversifierIndex)
  if (!integer(diversifierIndex, 1)) throw new ZalletError('Invalid vault diversifier index.')
  const configuration = zalletConfiguration()
  const startHeight = await syncedWallet()
  const result = row(await rpc('z_getaddressforaccount', [configuration.accountId, ['orchard'], diversifierIndex]), 'derived address')
  if (result.account_uuid !== configuration.accountId || result.diversifier_index !== diversifierIndex ||
      !Array.isArray(result.receiver_types) || result.receiver_types.length !== 1 || result.receiver_types[0] !== 'orchard' || typeof result.address !== 'string') {
    throw new ZalletError('Zallet did not derive the requested existing-account Orchard address.')
  }
  return { address: await orchardReceiver(result.address), accountId: configuration.accountId, startHeight }
}

export interface VaultReceipt { txid: string; outputIndex?: number; receiptId?: string; receiptType?: 'whole-shielded-account-transaction'; amountZatoshis: number; confirmations: number }
function memoMatches(output: Row, memo: string): boolean {
  if (output.memoStr !== memo || typeof output.memo !== 'string' || !/^[0-9a-f]{1024}$/i.test(output.memo)) return false
  const bytes = Buffer.from(memo, 'utf8')
  if (bytes.length > 512 || bytes[0] > 0xf4) return false
  return output.memo.toLowerCase() === bytes.toString('hex').padEnd(1024, '0')
}
function shieldedOutput(output: Row, address: string, value: number, memo: string): boolean {
  // NU6.3 reports Orchard-receiver notes under the distinct Ironwood pool.
  return (output.pool === 'orchard' || output.pool === 'ironwood') && output.address === address &&
    output.walletInternal === false && output.valueZat === value && memoMatches(output, memo)
}

export async function verifyVaultDeposit(input: { address: string; reference: string; amountZatoshis: number; startHeight: number }): Promise<VaultReceipt | null> {
  if (process.env.ZINGO_RPC_URL) return verifyZingoDeposit(input)
  amount(input.amountZatoshis)
  const configuration = zalletConfiguration()
  const height = await syncedWallet()
  if (!integer(input.startHeight, 1) || input.startHeight > height) throw new ZalletError('The wallet receipt start height is invalid or ahead of the current chain.')
  const address = await orchardReceiver(input.address)
  for (let page = 0; page < 50; page++) {
    const result = await rpc('z_listtransactions', [configuration.accountId, input.startHeight, null, page * 100, 100])
    if (!Array.isArray(result)) throw new ZalletError('Unsupported Zallet transaction list response.')
    for (const item of result) {
      const entry = row(item, 'transaction list entry')
      if (entry.account_uuid !== configuration.accountId) throw new ZalletError('Zallet returned a transaction from a different account.')
      const txid = transactionId(entry.txid)
      const tx = row(await rpc('z_viewtransaction', [txid]), 'transaction detail')
      if (transactionId(tx.txid) !== txid || !Array.isArray(tx.outputs) || !integer(tx.confirmations, -1)) throw new ZalletError('Unsupported Zallet receipt detail.')
      if (tx.status !== 'mined' || tx.confirmations < 1) continue
      for (const outputValue of tx.outputs) {
        const output = row(outputValue, 'decrypted output')
        if (output.account_uuid === configuration.accountId && output.outgoing === false && integer(output.action) &&
            shieldedOutput(output, address, input.amountZatoshis, input.reference)) {
          return { txid, outputIndex: output.action, amountZatoshis: input.amountZatoshis, confirmations: tx.confirmations }
        }
      }
    }
    if (result.length < 100) return null
  }
  throw new ZalletError('The wallet receipt scan exceeded its safe page limit; the operator must inspect the wallet.')
}

export async function prepareShieldedPayout(address: string, amountZatoshis: number): Promise<string> {
  if (process.env.ZINGO_RPC_URL) return prepareZingoPayout(address, amountZatoshis)
  amount(amountZatoshis)
  await syncedWallet()
  const recipient = await orchardReceiver(address)
  const configuration = zalletConfiguration()
  const balance = row(await rpc('z_getbalanceforaccount', [configuration.accountId, 1]), 'account balance')
  const pools = row(balance.pools, 'balance pools')
  const amounts = ['orchard', 'ironwood'].map((pool) => {
    if (pools[pool] === undefined) return 0
    const value = row(pools[pool], 'pool balance').valueZat
    if (!integer(value) || value > MAX_ZATOSHIS) throw new ZalletError('Unsupported Zallet spendable balance.')
    return value
  })
  const spendable = amounts.reduce((total, value) => total + value, 0)
  if (balance.minimum_confirmations !== 1 || !Number.isSafeInteger(spendable) || spendable <= amountZatoshis) {
    throw new ZalletError('The operator must fund the shielded testnet wallet for the full payout plus wallet-calculated fees.')
  }
  return recipient
}

export async function sendShieldedPayout(input: { address: string; amountZatoshis: number; memo: string; fundingTxid?: string; fundingReference?: string }): Promise<{ txid: string; broadcast: boolean }> {
  if (process.env.ZINGO_RPC_URL) return sendZingoPayout(input)
  const address = await prepareShieldedPayout(input.address, input.amountZatoshis)
  const memo = Buffer.from(input.memo, 'utf8')
  if (!memo.length || memo.length > 512 || memo[0] > 0xf4) throw new ZalletError('Invalid opaque payout memo.')
  const result = row(await rpc('z_sendfromaccount', [zalletConfiguration().accountId, 'orchard',
    [{ address, amount: formatZatoshis(input.amountZatoshis), memo: memo.toString('hex') }], 1, 'FullPrivacy'], true), 'send')
  // Multi-transaction sends and unrecognized responses require manual reconciliation.
  if (!Array.isArray(result.txids) || result.txids.length !== 1 || result.txid !== result.txids[0] || typeof result.broadcast !== 'boolean') {
    throw new ZalletSendUncertainError()
  }
  return { txid: transactionId(result.txid), broadcast: result.broadcast }
}

export async function inspectPayout(input: { txid: string; address: string; amountZatoshis: number; memo: string }): Promise<{ confirmed: boolean; confirmations: number }> {
  if (process.env.ZINGO_RPC_URL) return inspectZingoPayout(input)
  amount(input.amountZatoshis)
  await syncedWallet()
  const address = await orchardReceiver(input.address)
  const txid = transactionId(input.txid)
  const transaction = row(await rpc('z_viewtransaction', [txid]), 'payout detail')
  if (transactionId(transaction.txid) !== txid || !integer(transaction.confirmations, -1) || !Array.isArray(transaction.outputs)) {
    throw new ZalletError('Unsupported Zallet payout detail.')
  }
  const matches = transaction.outputs.some((value) => {
    const output = row(value, 'payout output')
    return output.outgoing === true && shieldedOutput(output, address, input.amountZatoshis, input.memo)
  })
  if (!matches) throw new ZalletError('The wallet has not verified the reserved payout receiver, amount and memo.')
  return { confirmed: transaction.status === 'mined' && transaction.confirmations >= 1, confirmations: transaction.confirmations }
}
