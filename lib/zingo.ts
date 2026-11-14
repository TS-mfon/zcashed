import { MAX_ZATOSHIS, parseShieldedAddress } from './zcash'

const TXID = /^[0-9a-f]{64}$/i
export class ZingoError extends Error { readonly status = 503 }
export class ZingoPrebroadcastError extends ZingoError {}
export interface ZingoFeeStatus {
  spendableZatoshis: number
  protectedPrincipalZatoshis: number
  feeAvailableZatoshis: number
  requiredFeeReserveZatoshis: number
  feeShortfallZatoshis: number
  activeFundedJobs: number
  pendingPayouts: number
  feeReservePerJobZatoshis: number
  principalProtection: true
}
export function zingoConfiguration() {
  const raw = process.env.ZINGO_RPC_URL?.trim()
  const user = process.env.ZINGO_RPC_USER
  const password = process.env.ZINGO_RPC_PASSWORD
  const accountId = process.env.ZINGO_ACCOUNT_ID?.trim()
  if (!raw || !user || !password || accountId !== '0') throw new ZingoError('The native testnet vault is not configured.')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ZingoError('The native vault requires an authenticated HTTPS endpoint.')
  return { url: url.toString(), accountId, authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64') }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ZingoError('The native wallet returned an unsupported response.')
  return value as Record<string, unknown>
}
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function budget(value: number) { if (!positive(value) || value > MAX_ZATOSHIS) throw new ZingoError('Invalid integer vault amount.') }
function orchard(value: string) {
  const parsed = parseShieldedAddress(value, 'testnet')
  if (parsed.preferredPool !== 'orchard') throw new ZingoError('Use a testnet Unified Address with an Orchard receiver.')
  return parsed.address
}
async function rpc(method: string, input: unknown, sending = false): Promise<unknown> {
  const configuration = zingoConfiguration()
  const id = crypto.randomUUID()
  try {
    const response = await fetch(configuration.url, { method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: configuration.authorization },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: [input] }), signal: AbortSignal.timeout(sending ? 90000 : 30000) })
    const envelope = object(await response.json())
    if (sending && envelope.id === id && envelope.error && typeof envelope.error === 'object') {
      const data = (envelope.error as {data?: {stage?: unknown; retryable?: unknown}}).data
      if (data?.stage === 'prebroadcast' && data.retryable === true) {
        const reason = (envelope.error as {message?: unknown}).message
        throw new ZingoPrebroadcastError(typeof reason === 'string' && reason.length <= 500 ? reason : 'The wallet confirmed that no transfer was broadcast. You can authorize another attempt.')
      }
    }
    if (!response.ok || envelope.id !== id || envelope.error || !Object.hasOwn(envelope, 'result')) throw new ZingoError('The native testnet wallet cannot complete this operation.')
    return envelope.result
  } catch (error) {
    if (error instanceof ZingoPrebroadcastError) throw error
    if (sending) throw new ZingoError('Broadcast outcome is uncertain. The vault will not resend; the operator must reconcile the wallet.')
    if (error instanceof ZingoError) throw error
    throw new ZingoError('The native testnet vault service is unavailable.')
  }
}
export async function deriveZingoVaultAddress(allocationKey: number) {
  if (!positive(allocationKey)) throw new ZingoError('Invalid vault allocation.')
  const result = object(await rpc('vault_create_address', { allocationKey }))
  if (result.accountId !== '0' || result.allocationKey !== allocationKey || !positive(result.startHeight) || typeof result.address !== 'string') throw new ZingoError('The wallet did not return the reserved vault address.')
  return { address: orchard(result.address), accountId: '0', startHeight: result.startHeight }
}
export async function verifyZingoDeposit(input: {address: string; reference: string; amountZatoshis: number; startHeight: number}) {
  orchard(input.address); budget(input.amountZatoshis)
  if (!positive(input.startHeight)) throw new ZingoError('Invalid funding start height.')
  const raw = await rpc('vault_verify_deposit', input)
  if (raw === null) return null
  const result = object(raw)
  if (typeof result.txid !== 'string' || !TXID.test(result.txid) || result.receiptId !== result.txid ||
      result.receiptType !== 'whole-shielded-account-transaction' || result.accountId !== '0' ||
      result.amountZatoshis !== input.amountZatoshis || result.memo !== input.reference || !positive(result.confirmations) ||
      !Array.isArray(result.poolsReceived) || !result.poolsReceived.length || result.poolsReceived.some(pool => !['orchard', 'ironwood'].includes(String(pool).toLowerCase()))) throw new ZingoError('The native wallet did not verify a matching shielded transaction receipt.')
  return { txid: result.txid.toLowerCase(), receiptId: result.txid.toLowerCase(), receiptType: 'whole-shielded-account-transaction' as const,
    amountZatoshis: input.amountZatoshis, confirmations: result.confirmations }
}
export async function prepareZingoPayout(address: string, amountZatoshis: number) {
  budget(amountZatoshis); const recipient = orchard(address)
  const result = object(await rpc('vault_prepare_payout', {address: recipient, amountZatoshis}))
  if (result.principalProtection !== true) throw new ZingoError('The vault operator must finish the principal-protection upgrade before releasing funds.')
  if (result.address !== recipient || !positive(result.spendableZatoshis) || result.spendableZatoshis <= amountZatoshis ||
      result.feeShortfallZatoshis !== 0 || result.pendingPayouts !== 0) throw new ZingoError('The operator must top up its fee balance or reconcile a pending payout. Job deposits stay protected.')
  return recipient
}
export async function getZingoFeeStatus(): Promise<ZingoFeeStatus> {
  const result = object(await rpc('vault_fee_status', {}))
  const fields = ['spendableZatoshis', 'protectedPrincipalZatoshis', 'feeAvailableZatoshis', 'requiredFeeReserveZatoshis',
    'feeShortfallZatoshis', 'activeFundedJobs', 'pendingPayouts', 'feeReservePerJobZatoshis'] as const
  if (result.principalProtection !== true || fields.some(field => typeof result[field] !== 'number' ||
      !Number.isSafeInteger(result[field]) || (result[field] as number) < 0)) throw new ZingoError('The native vault did not return its protected principal and fee reserves.')
  return result as unknown as ZingoFeeStatus
}
export async function sendZingoPayout(input: {address: string; amountZatoshis: number; memo: string; fundingTxid?: string; fundingReference?: string}) {
  budget(input.amountZatoshis); orchard(input.address)
  if (typeof input.fundingTxid !== 'string' || !TXID.test(input.fundingTxid) ||
      typeof input.fundingReference !== 'string' || !/^zcashed:v1:deposit:[0-9a-f-]{36}$/.test(input.fundingReference)) throw new ZingoError('The payout requires its original verified funding receipt.')
  const memo = Buffer.from(input.memo, 'utf8')
  if (!memo.length || memo.length > 512) throw new ZingoError('Invalid payout memo.')
  const result = object(await rpc('vault_send_payout', input, true))
  if (typeof result.txid !== 'string' || !TXID.test(result.txid) || result.broadcast !== true) throw new ZingoError('Broadcast outcome is unverified; automatic resend is disabled.')
  return {txid: result.txid.toLowerCase(), broadcast: true}
}
export async function inspectZingoPayout(input: {txid: string; address: string; amountZatoshis: number; memo: string}) {
  if (!TXID.test(input.txid)) throw new ZingoError('Invalid payout transaction.')
  orchard(input.address); budget(input.amountZatoshis)
  const result = object(await rpc('vault_inspect_payout', input))
  if (typeof result.confirmed !== 'boolean' || typeof result.confirmations !== 'number' || !Number.isSafeInteger(result.confirmations) || result.confirmations < 0 || result.confirmed !== (result.confirmations > 0)) throw new ZingoError('The wallet returned an unsupported confirmation state.')
  return {confirmed: result.confirmed, confirmations: result.confirmations}
}
export async function releaseZingoPrebroadcast(memo: string): Promise<void> {
  if (!memo || Buffer.byteLength(memo, 'utf8') > 512) throw new ZingoError('Invalid payout reservation memo.')
  const result = object(await rpc('vault_release_prebroadcast', {memo}))
  if (result.released !== true || result.stage !== 'prebroadcast' || result.retryable !== true) throw new ZingoError('The wallet has not proved that this reservation is safe to release.')
}
