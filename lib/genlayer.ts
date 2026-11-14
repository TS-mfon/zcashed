import { createClient, createAccount } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import {
  ExecutionResult,
  TransactionHashVariant,
  TransactionStatus,
  transactionsStatusNameToNumber,
  executionResultNumberToName,
  type GenLayerTransaction,
  type TransactionHash,
} from 'genlayer-js/types'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { acquireJobLease, releaseJobLease, readOperationJournal, reserveOperation, attachOperationHash, patchOperation, removeFailedOperation, releaseUndispatchedOperation, GenLayerBusyError } from './genlayer-operations'
export { GenLayerBusyError } from './genlayer-operations'

export type CriterionDecision = {
  id: string
  status: 'passed' | 'failed' | 'inconclusive'
  feedback: string
}

export type Judgment = {
  verdict: 'approved' | 'needs_revision' | 'inconclusive' | 'rejected'
  reason: string
  criteria: CriterionDecision[]
}

class GenLayerExecutionError extends Error {}

function operationKey(address: string, method: string, args: string[], scope: string): string {
  return createHash('sha256').update(JSON.stringify([address.toLowerCase(), method, args, scope])).digest('hex')
}

async function resumeOperation(client: ReturnType<typeof getClient>, address: string, method: string, args: string[], scope = '') {
  const key = operationKey(address, method, args, scope)
  const journal = await readOperationJournal()
  if (Object.entries(journal).some(([otherKey, entry]) => otherKey !== key && entry.address === address.toLowerCase() && (entry.pending || !entry.settled))) {
    throw new GenLayerBusyError('A previous GenLayer transaction needs reconciliation. Retry its original public artifact first.')
  }
  const reservation = await reserveOperation(key, address.toLowerCase())
  let hash = reservation.record.hash
  if (!hash) {
    if (!reservation.isNew) throw new GenLayerBusyError('A previous GenLayer transaction has an unknown dispatch outcome. Operator reconciliation is required before retrying.')
    const dispatched = await dispatchReserved(client, key, reservation.record.dispatchToken!, () =>
      client.writeContract({ address: contractAddress(address), functionName: method, args, value: 0n, leaderOnly: false }))
    if (typeof dispatched !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(dispatched)) throw new Error('GenLayer returned an invalid transaction hash')
    await attachOperationHash(key, reservation.record.dispatchToken!, dispatched)
    hash = dispatched
  }
  if (!hash) throw new Error('GenLayer transaction hash is unavailable; operator reconciliation is required')
  try { await successfulFinalization(client, hash) }
  catch (error) {
    if (error instanceof GenLayerExecutionError) await removeFailedOperation(key)
    throw error
  }
  return { key, hash }
}

async function completeOperation(key: string): Promise<void> {
  await patchOperation(key, { pending: false })
}

export async function hasUnsettledJobOperation(address: string): Promise<boolean> {
  const normalized = contractAddress(address).toLowerCase()
  return Object.values(await readOperationJournal()).some((entry) => entry.address === normalized && (entry.pending || !entry.settled))
}

async function acknowledgeOperation(key: string): Promise<void> {
  const entry = (await readOperationJournal())[key]
  if (!entry) return
  if (entry.pending) throw new Error('GenLayer transaction is still pending reconciliation')
  await patchOperation(key, { settled: true })
}

export async function acknowledgeAssignment(address: string, actor: string): Promise<void> {
  await acknowledgeOperation(operationKey(contractAddress(address), 'accept_job', [workerDemoId(actor)], ''))
}

export async function acknowledgeReview(address: string, content: string, actor: string, attempt: number): Promise<void> {
  await acknowledgeOperation(operationKey(contractAddress(address), 'submit_work', [content.trim(), workerDemoId(actor)], String(attempt)))
}

export async function hasRecoverableReview(address: string, content: string, actor: string, attempt: number): Promise<boolean> {
  const entry = (await readOperationJournal())[operationKey(contractAddress(address), 'submit_work', [content.trim(), workerDemoId(actor)], String(attempt))]
  return Boolean(entry?.hash && (entry.pending || !entry.settled))
}

export async function withJobOperation<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
  const lease = await acquireJobLease(jobId)
  try { return await operation() }
  finally { await releaseJobLease(lease) }
}

function getPrivateKey(): `0x${string}` {
  const key = process.env.GENLAYER_PRIVATE_KEY
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Configure a valid GENLAYER_PRIVATE_KEY for the GenLayer Studio deployer')
  }
  return key as `0x${string}`
}

function getClient() {
  const account = createAccount(getPrivateKey())
  let signed = false
  const signTransaction = (async (...parameters: Parameters<typeof account.signTransaction>) => {
    if (signed) throw new Error('Automatic GenLayer resend is blocked; operator reconciliation is required')
    const serialized = await account.signTransaction(...parameters)
    signed = true
    return serialized
  }) as typeof account.signTransaction
  // genlayer-js@1.1.8 dispatches local-account writes only after signing. Marking
  // at signing completion is conservative: every later failure remains unknown.
  const client = createClient({ chain: studionet, account: { ...account, signTransaction } })
  return { ...client, dispatchMayHaveStarted: () => signed, dispatchSigner: account.address.toLowerCase() }
}

async function dispatchReserved<T>(client: ReturnType<typeof getClient>, key: string, token: string, dispatch: () => Promise<T>): Promise<T> {
  // All jobs share a deployer. Serialize nonce lookup and dispatch across jobs too.
  try { return await withJobOperation('genlayer-signer:' + client.dispatchSigner, dispatch) }
  catch (error) {
    if (!client.dispatchMayHaveStarted()) await releaseUndispatchedOperation(key, token)
    throw error
  }
}

function contractAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Missing or invalid GenLayer contract address')
  return value as `0x${string}`
}

function workerDemoId(actor: string): string {
  if (!actor?.trim()) throw new Error('Worker demo identity is required')
  return 'worker:' + createHash('sha256').update(actor).digest('hex')
}

async function successfulFinalization(client: ReturnType<typeof getClient>, hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('GenLayer returned an invalid transaction hash')
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    interval: 1500,
    retries: 80,
  })
  const finalized = receipt.statusName === TransactionStatus.FINALIZED ||
    receipt.status === TransactionStatus.FINALIZED ||
    receipt.status === Number(transactionsStatusNameToNumber[TransactionStatus.FINALIZED])
  if (!finalized) throw new Error('GenLayer transaction has not finalized: ' + hash)
  if (!executionSucceeded(receipt)) {
    if (executionFailed(receipt)) throw new GenLayerExecutionError('GenLayer contract execution failed: ' + hash)
    throw new Error('GenLayer contract execution is unverified: ' + hash)
  }
  return receipt
}

function executionFailed(receipt: GenLayerTransaction): boolean {
  if (receipt.txExecutionResultName !== undefined) return receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR
  if (receipt.txExecutionResult !== undefined) return receipt.txExecutionResult === 2
  return receipt.consensus_data?.leader_receipt?.some((leader) => leader.execution_result === 'ERROR') ?? false
}

function executionSucceeded(receipt: GenLayerTransaction): boolean {
  // Stable chain receipts expose the named result or its documented numeric enum.
  if (receipt.txExecutionResultName !== undefined) {
    return receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN
  }
  if (receipt.txExecutionResult !== undefined) {
    return executionResultNumberToName[String(receipt.txExecutionResult) as keyof typeof executionResultNumberToName] ===
      ExecutionResult.FINISHED_WITH_RETURN
  }
  // Studio serializes Receipt.execution_result using ExecutionResultStatus.SUCCESS.
  // Primary source: genlayer-studio/backend/node/types.py. Missing evidence fails closed.
  const leaders = receipt.consensus_data?.leader_receipt
  return Array.isArray(leaders) && leaders.length > 0 &&
    leaders.every((leader) => leader.execution_result === 'SUCCESS')
}

export async function deployEscrowContract(params: {
  taskTitle: string
  taskDescription: string
  creationScope?: string
  onTransactionHash?: (hash: string) => Promise<void>
}): Promise<string> {
  if (!params.creationScope || !/^[0-9a-f]{64}$/.test(params.creationScope)) throw new Error('A durable job creation scope is required before deploying GenLayer')
  const client = getClient()
  const address = '0x0000000000000000000000000000000000000000'
  // Scope, rather than current source code, identifies an existing deploy across releases.
  const key = operationKey(address, 'deploy_escrow', [], params.creationScope)
  const reservation = await reserveOperation(key, address)
  let hash = reservation.record.hash
  if (!hash) {
    if (!reservation.isNew) throw new GenLayerBusyError('The original deployment has an unknown dispatch outcome. Operator reconciliation is required before retrying.')
    const dispatched = await dispatchReserved(client, key, reservation.record.dispatchToken!, async () => {
      const code = fs.readFileSync(path.join(process.cwd(), 'contracts', 'escrow.py'), 'utf8')
      return client.deployContract({ code, args: [params.taskTitle, params.taskDescription], leaderOnly: false })
    })
    // Persist before polling. A timeout or lost response must never cause another deploy.
    await attachOperationHash(key, reservation.record.dispatchToken!, dispatched)
    hash = dispatched
  }
  await params.onTransactionHash?.(hash)
  const receipt = await successfulFinalization(client, hash)
  const deployed = receipt.data?.contract_address
  if (typeof deployed !== 'string') throw new Error('Successful GenLayer receipt is missing the deployed contract address')
  return contractAddress(deployed)
}

export async function acceptJobOnChain(address: string, actor: string): Promise<string> {
  const client = getClient()
  const worker = workerDemoId(actor)
  const { key, hash } = await resumeOperation(client, contractAddress(address), 'accept_job', [worker])
  const state = await readState(client, address)
  if (state.status !== 'in_progress' || state.worker_demo_id !== worker) throw new Error('Finalized GenLayer assignment does not match this worker')
  await completeOperation(key)
  return hash
}

export async function submitWorkOnChain(
  address: string,
  submissionContent: string,
  actor: string,
  requestedAttempt?: number,
): Promise<Judgment & { txHash: string; approved: boolean; rejectionReason: string; attempt: number }> {
  if (requestedAttempt !== undefined && (!Number.isSafeInteger(requestedAttempt) || requestedAttempt < 1 || requestedAttempt > 3)) throw new Error('GenLayer adjudication attempt must be between one and three')
  const client = getClient()
  const content = submissionContent.trim()
  const worker = workerDemoId(actor)
  const { key, hash } = await resumeOperation(client, contractAddress(address), 'submit_work', [content, worker], String(requestedAttempt ?? ''))
  const state = await readState(client, address)
  if (state.current_submission !== content || state.worker_demo_id !== worker) {
    throw new Error('Finalized GenLayer state does not match this submission')
  }
  if (requestedAttempt !== undefined && Number(state.submission_count) !== requestedAttempt) throw new Error('Finalized GenLayer adjudication count does not match this attempt')
  const judgment = parseJudgment(state.judgment, state.rubric, state.submission_count)
  if (state.status !== judgment.verdict) throw new Error('Finalized GenLayer status does not match its criterion decisions')
  await completeOperation(key)
  return {
    ...judgment,
    txHash: hash,
    approved: judgment.verdict === 'approved',
    rejectionReason: judgment.reason,
    attempt: Number(state.submission_count),
  }
}

function parseJudgment(raw: unknown, rubric: unknown, submissionCount: unknown): Judgment {
  const count = typeof submissionCount === 'string' && /^[1-3]$/.test(submissionCount) ? Number(submissionCount) : submissionCount
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 3) throw new Error('GenLayer returned an invalid adjudication count')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GenLayer returned no valid judgment')
  const result = raw as Record<string, unknown>
  if (!Array.isArray(result.criteria) || !Array.isArray(rubric) || rubric.length === 0 ||
      result.criteria.length !== rubric.length) throw new Error('GenLayer judgment is missing rubric decisions')
  const expectedIds = rubric.map((item: unknown) => {
    if (!item || typeof item !== 'object' || typeof (item as Record<string, unknown>).id !== 'string') {
      throw new Error('GenLayer returned an invalid rubric')
    }
    return (item as { id: string }).id
  })
  const criteria = result.criteria.map((entry: unknown, index: number): CriterionDecision => {
    if (!entry || typeof entry !== 'object') throw new Error('GenLayer returned an invalid criterion decision')
    const criterion = entry as Record<string, unknown>
    if (criterion.id !== expectedIds[index] ||
        !['passed', 'failed', 'inconclusive'].includes(String(criterion.status)) ||
        typeof criterion.feedback !== 'string' || !criterion.feedback.trim() || criterion.feedback.length > 500) {
      throw new Error('GenLayer returned an invalid criterion decision')
    }
    return { id: criterion.id as string, status: criterion.status as CriterionDecision['status'], feedback: criterion.feedback }
  })
  if (new Set(expectedIds).size !== expectedIds.length) throw new Error('GenLayer rubric contains duplicate IDs')
  const passed = criteria.every((entry) => entry.status === 'passed')
  const verdict = passed ? 'approved' : count === 3 ? 'rejected' :
    criteria.some((entry) => entry.status === 'inconclusive') ? 'inconclusive' : 'needs_revision'
  if (result.verdict !== verdict || typeof result.reason !== 'string') throw new Error('GenLayer judgment contradicts its evidence')
  const reason = criteria.filter((entry) => entry.status !== 'passed').map((entry) => entry.id + ': ' + entry.feedback).join('\n')
  return { verdict, reason, criteria }
}

async function readState(client: ReturnType<typeof getClient>, address: string): Promise<Record<string, unknown>> {
  const result = await client.readContract({
    address: contractAddress(address),
    functionName: 'get_state',
    args: [],
    jsonSafeReturn: true,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('GenLayer returned no finalized state')
  return result as Record<string, unknown>
}

export async function readContractState(address: string): Promise<Record<string, unknown>> {
  return readState(getClient(), address)
}

export function getGenLayerAccount(): string {
  return createAccount(getPrivateKey()).address
}
