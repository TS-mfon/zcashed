import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionResult, TransactionHashVariant, TransactionStatus } from 'genlayer-js/types'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const contractHarness = String.raw`
import importlib.util, json, sys, types
from pathlib import Path

class UserError(Exception):
    pass

class Return:
    def __init__(self, calldata):
        self.calldata = calldata

class Public:
    write = staticmethod(lambda fn: fn)
    view = staticmethod(lambda fn: fn)

calls = []
answers = [{"criteria": [{"id": "C1", "status": "passed", "feedback": "The summary states the issue."}]}]
def exec_prompt(prompt, **kwargs):
    calls.append(prompt)
    return answers[min(len(calls) - 1, len(answers) - 1)]

def run_nondet_unsafe(leader, validator):
    result = leader()
    if not validator(Return(result)):
        raise UserError("Independent validator disagreed")
    return result

gl = types.SimpleNamespace(
    Contract=object, public=Public(), message=types.SimpleNamespace(sender_address="deployer"),
    nondet=types.SimpleNamespace(exec_prompt=exec_prompt),
    vm=types.SimpleNamespace(UserError=UserError, Return=Return, run_nondet_unsafe=run_nondet_unsafe),
)
module = types.ModuleType("genlayer")
module.gl, module.Address, module.u256 = gl, str, int
module.__all__ = ["gl", "Address", "u256"]
sys.modules["genlayer"] = module
spec = importlib.util.spec_from_file_location("quality_contract", Path("contracts/escrow.py"))
contract_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract_module)
contract = contract_module.ZCashedEscrow("Public summary", "State the issue in a concise summary.")
assert contract.owner == "deployer"
gl.message.sender_address = "stranger"
try:
    contract.accept_job("worker:" + "a" * 64)
    raise AssertionError("Non-deployer changed contract state")
except UserError:
    pass
gl.message.sender_address = "deployer"
contract.accept_job("worker:" + "a" * 64)
scenario = sys.argv[1] if len(sys.argv) > 1 else "approved"
content = "The issue is a missing keyboard shortcut in the editor."
worker = "worker:" + "a" * 64
if scenario == "disagreement":
    answers.append({"criteria": [{"id": "C1", "status": "failed", "feedback": "The issue is absent."}]})
elif scenario == "malformed":
    answers = [{"verdict": "approved"}]
elif scenario in ("missing", "missing_upper"):
    content = "https://example.com/public/document" if scenario == "missing" else "HTTPS://example.com/public/document"
elif scenario == "wrong_worker":
    worker = "worker:" + "b" * 64
elif scenario == "unauthorized":
    gl.message.sender_address = "stranger"
elif scenario in ("needs_revision", "inconclusive", "limit"):
    status = "failed" if scenario in ("needs_revision", "limit") else "inconclusive"
    answers = [{"criteria": [{"id": "C1", "status": status, "feedback": "Add the public issue text."}]}]
if scenario == "limit":
    for attempt, expected in enumerate(("needs_revision", "needs_revision", "rejected")):
        result = contract.submit_work(content + str(attempt), worker)
        assert result["verdict"] == expected
    try:
        contract.submit_work(content + "fourth", worker)
        raise AssertionError("A fourth adjudication was allowed")
    except UserError:
        pass
    assert contract.submission_count == 3
    assert len(calls) == 6
elif scenario in ("disagreement", "malformed", "wrong_worker", "unauthorized"):
    try:
        contract.submit_work(content, worker)
        raise AssertionError("Unsafe judgment changed state")
    except UserError:
        pass
    assert contract.status == "in_progress"
    assert contract.current_submission == ""
    assert contract.submission_count == 0
else:
    result = contract.submit_work(content, worker)
    expected = "inconclusive" if scenario in ("missing", "missing_upper") else scenario
    assert result["verdict"] == expected
    assert contract.status == expected
    assert contract.submission_count == 1
    assert len(calls) == (0 if scenario in ("missing", "missing_upper") else 2), "Validator must independently judge the artifact"
assert "budget_zec" not in contract.get_state()
assert "payment_tx_hash" not in contract.get_state()
print(json.dumps({"status": contract.status, "judgeCalls": len(calls)}))
`

const sdk = vi.hoisted(() => ({
  deployContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('genlayer-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('genlayer-js')>()
  return { ...original, createClient: vi.fn(() => sdk) }
})

import { acceptJobOnChain, acknowledgeAssignment, acknowledgeReview, deployEscrowContract, getGenLayerAccount, hasUnsettledJobOperation, readContractState, submitWorkOnChain, withJobOperation } from '../lib/genlayer'
import { createHash } from 'node:crypto'

const address = '0x1111111111111111111111111111111111111111'
const hash = `0x${'2'.repeat(64)}`
let testDataDir: string

beforeEach(() => {
  vi.clearAllMocks()
  testDataDir = mkdtempSync(path.join(tmpdir(), 'zcashed-genlayer-test-'))
  vi.stubEnv('ZCASHED_DATA_DIR', testDataDir)
  vi.stubEnv('MONGODB_URI', '')
  vi.stubEnv('NODE_ENV', 'test')
  process.env.GENLAYER_PRIVATE_KEY = `0x${'3'.repeat(64)}`
  sdk.deployContract.mockResolvedValue(hash)
  sdk.writeContract.mockResolvedValue(hash)
  sdk.readContract.mockResolvedValue({ status: 'in_progress', worker_demo_id: 'worker:' + createHash('sha256').update('demo_worker').digest('hex') })
  sdk.waitForTransactionReceipt.mockResolvedValue({
    statusName: TransactionStatus.FINALIZED,
    txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN,
    data: { contract_address: address },
  })
})
afterEach(() => {
  rmSync(testDataDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('GenLayer provider boundary', () => {
  it('returns the successfully finalized deployment address and sends only the public rubric', async () => {
    await expect(deployEscrowContract({
      taskTitle: 'Public summary',
      taskDescription: 'Summarize the supplied public issue in three sentences.',
    })).resolves.toBe(address)
    expect(sdk.deployContract).toHaveBeenCalledWith(expect.objectContaining({
      args: ['Public summary', 'Summarize the supplied public issue in three sentences.'],
      leaderOnly: false,
    }))
    expect(sdk.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({
      hash,
      status: TransactionStatus.FINALIZED,
    }))
  })
  it('enforces the deployer boundary and independently judges the Python public artifact', () => {
    const result = spawnSync('python3', ['-c', contractHarness], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ status: 'approved', judgeCalls: 2 })
  })
  it.each([
    { statusName: TransactionStatus.ACCEPTED, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN },
    { statusName: TransactionStatus.FINALIZED, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR },
    { statusName: TransactionStatus.FINALIZED },
  ])('rejects an unfinalized, failed or unverified execution: %j', async (receipt) => {
    sdk.waitForTransactionReceipt.mockResolvedValue(receipt)
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/GenLayer/)
  })
  it('accepts documented finalized Studio SUCCESS receipts', async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({
      status: 7, consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
    })
    await expect(acceptJobOnChain(address, 'demo_worker')).resolves.toBe(hash)
    expect(sdk.writeContract.mock.calls[0][0].args[0]).toMatch(/^worker:[0-9a-f]{64}$/)
  })
  it('never replaces an explicit execution failure with a legacy success entry', async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({
      status: 7, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR,
      consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
    })
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/execution failed/)
  })
  it('reads the finalized public criterion judgment for the exact submitted artifact', async () => {
    const content = 'The issue is a missing keyboard shortcut in the public editor.'
    sdk.readContract.mockResolvedValue({
      current_submission: content,
      worker_demo_id: 'worker:' + createHash('sha256').update('demo_worker').digest('hex'),
      status: 'inconclusive', submission_count: '1', rubric: [{ id: 'C1' }],
      judgment: { verdict: 'inconclusive', reason: 'C1: Source text is missing.',
        criteria: [{ id: 'C1', status: 'inconclusive', feedback: 'Source text is missing.' }] },
    })
    await expect(submitWorkOnChain(address, content, 'demo_worker')).resolves.toMatchObject({
      approved: false, verdict: 'inconclusive', rejectionReason: 'C1: Source text is missing.', txHash: hash,
    })
    expect(sdk.readContract).toHaveBeenCalledWith(expect.objectContaining({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL }))
  })
  it('rejects stale or contradictory finalized evidence', async () => {
    sdk.readContract.mockResolvedValue({ status: 'approved', current_submission: 'An earlier artifact' })
    await expect(submitWorkOnChain(address, 'This is the actual public artifact text.', 'demo_worker')).rejects.toThrow(/does not match/)
  })
  it.each([
    {},
    { verdict: 'approved', reason: '', criteria: [] },
    { verdict: 'approved', reason: '', criteria: [{ id: 'C1', status: 'passed', feedback: '' }] },
    { verdict: 'approved', reason: '', criteria: [{ id: 'C2', status: 'passed', feedback: 'All requirements met.' }] },
    { verdict: 'approved', reason: '', criteria: [{ id: 'C1', status: 'inconclusive', feedback: 'Evidence is missing.' }] },
  ])('rejects a malformed or unsupported approval: %j', async (judgment) => {
    const content = 'This is the actual public artifact text.'
    sdk.readContract.mockResolvedValue({
      current_submission: content, worker_demo_id: 'worker:' + createHash('sha256').update('demo_worker').digest('hex'),
      status: 'approved', submission_count: '1', rubric: [{ id: 'C1' }], judgment,
    })
    await expect(submitWorkOnChain(address, content, 'demo_worker')).rejects.toThrow(/GenLayer/)
  })
  it('reads finalized state and rejects an empty provider response', async () => {
    sdk.readContract.mockResolvedValue(null)
    await expect(readContractState(address)).rejects.toThrow(/no finalized state/)
    expect(sdk.readContract).toHaveBeenCalledWith(expect.objectContaining({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL }))
  })
  it('rejects missing deployment addresses and invalid contract addresses', async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({ status: 7, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN })
    await expect(deployEscrowContract({ taskTitle: 'Public summary', taskDescription: 'State the issue in a concise summary.' })).rejects.toThrow(/missing the deployed contract address/)
    await expect(acceptJobOnChain('', 'demo_worker')).rejects.toThrow(/contract address/)
  })
  it.each([
    ['disagreement', 'in_progress', 2], ['malformed', 'in_progress', 1], ['wrong_worker', 'in_progress', 0],
    ['unauthorized', 'in_progress', 0], ['missing', 'inconclusive', 0], ['needs_revision', 'needs_revision', 2], ['inconclusive', 'inconclusive', 2],
    ['limit', 'rejected', 6],
    ['missing_upper', 'inconclusive', 0],
  ])('keeps Python consensus and missing-evidence decisions safe: %s', (scenario, status, judgeCalls) => {
    const result = spawnSync('python3', ['-c', contractHarness, String(scenario)], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ status, judgeCalls })
  })
  it('requires explicitly configured deployer credentials without generating a key', () => {
    delete process.env.GENLAYER_PRIVATE_KEY
    expect(() => getGenLayerAccount()).toThrow(/GENLAYER_PRIVATE_KEY/)
  })
  it('allows only one operation per job until the first operation finishes and then permits a retry', async () => {
    let finish!: () => void
    const first = withJobOperation('locked-job', () => new Promise<void>((resolve) => { finish = resolve }))
    await expect(withJobOperation('locked-job', async () => 'second')).rejects.toThrow(/in progress/)
    finish()
    await first
    await expect(withJobOperation('locked-job', async () => 'retry')).resolves.toBe('retry')
  })
  it('retries the original acceptance transaction after a finalization timeout', async () => {
    sdk.waitForTransactionReceipt.mockRejectedValueOnce(new Error('Finalization timed out'))
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/timed out/)
    await expect(acceptJobOnChain(address, 'demo_worker')).resolves.toBe(hash)
    expect(sdk.writeContract).toHaveBeenCalledOnce()
  })
  it('recovers a finalized judgment after a read failure without submitting another transaction', async () => {
    const content = 'This is the actual public artifact text.'
    sdk.readContract.mockRejectedValueOnce(new Error('Finalized read unavailable')).mockResolvedValue({
      current_submission: content, worker_demo_id: 'worker:' + createHash('sha256').update('demo_worker').digest('hex'),
      status: 'approved', submission_count: '1', rubric: [{ id: 'C1' }], judgment: { verdict: 'approved', reason: '',
        criteria: [{ id: 'C1', status: 'passed', feedback: 'The supplied text meets the criterion.' }] },
    })
    await expect(submitWorkOnChain(address, content, 'demo_worker')).rejects.toThrow(/read unavailable/)
    await expect(submitWorkOnChain(address, content, 'demo_worker')).resolves.toMatchObject({ approved: true, txHash: hash })
    expect(sdk.writeContract).toHaveBeenCalledOnce()
  })
  it('recovers the submitted acceptance hash after a server module restart', async () => {
    sdk.waitForTransactionReceipt.mockRejectedValueOnce(new Error('Finalization timed out'))
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/timed out/)
    vi.resetModules()
    const restarted = await import('../lib/genlayer')
    await expect(restarted.acceptJobOnChain(address, 'demo_worker')).resolves.toBe(hash)
    expect(sdk.writeContract).toHaveBeenCalledOnce()
  })
  it('blocks a different artifact while the previous transaction still needs reconciliation', async () => {
    sdk.readContract.mockRejectedValue(new Error('Finalized read unavailable'))
    await expect(submitWorkOnChain(address, 'This is the original public artifact text.', 'demo_worker')).rejects.toThrow(/read unavailable/)
    await expect(submitWorkOnChain(address, 'This is a different public artifact text.', 'demo_worker')).rejects.toThrow(/previous GenLayer transaction/)
    expect(sdk.writeContract).toHaveBeenCalledOnce()
  })
  it('permits a new write after a verified execution error applied no state changes', async () => {
    sdk.waitForTransactionReceipt.mockResolvedValueOnce({ status: 7, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR })
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/execution failed/)
    await expect(acceptJobOnChain(address, 'demo_worker')).resolves.toBe(hash)
    expect(sdk.writeContract).toHaveBeenCalledTimes(2)
  })
  it('retains an uncertain dispatch without automatically writing another transaction', async () => {
    sdk.writeContract.mockRejectedValueOnce(new Error('Provider connection lost'))
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/connection lost/)
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/unknown dispatch outcome/)
    expect(sdk.writeContract).toHaveBeenCalledOnce()
  })
  it('fails before a provider write if the durable recovery journal is corrupted', async () => {
    writeFileSync(path.join(testDataDir, 'genlayer-operations.json'), '{invalid')
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/journal is invalid/)
    expect(sdk.writeContract).not.toHaveBeenCalled()
  })
  it('allows a deliberate new adjudication of the same artifact while keeping each attempt idempotent', async () => {
    const content = 'This public artifact still needs the supplied source text.'
    const state = (count: string) => ({ current_submission: content, submission_count: count,
      worker_demo_id: 'worker:' + createHash('sha256').update('demo_worker').digest('hex'), status: 'needs_revision',
      rubric: [{ id: 'C1' }], judgment: { verdict: 'needs_revision', reason: 'C1: Supply source text.',
        criteria: [{ id: 'C1', status: 'failed', feedback: 'Supply source text.' }] } })
    sdk.readContract.mockResolvedValueOnce(state('1')).mockResolvedValue(state('2'))
    await expect(submitWorkOnChain(address, content, 'demo_worker', 1)).resolves.toMatchObject({ attempt: 1 })
    await acknowledgeReview(address, content, 'demo_worker', 1)
    await expect(submitWorkOnChain(address, content, 'demo_worker', 2)).resolves.toMatchObject({ attempt: 2 })
    await expect(submitWorkOnChain(address, content, 'demo_worker', 2)).resolves.toMatchObject({ attempt: 2 })
    expect(sdk.writeContract).toHaveBeenCalledTimes(2)
  })
  it('refuses to report assignment success when finalized state does not contain the assigned worker', async () => {
    sdk.readContract.mockResolvedValue({ status: 'open', worker_demo_id: '' })
    await expect(acceptJobOnChain(address, 'demo_worker')).rejects.toThrow(/assignment/)
  })
  it('keeps finalized assignment durably unsettled until the local job write is acknowledged', async () => {
    await acceptJobOnChain(address, 'demo_worker')
    expect(await hasUnsettledJobOperation(address)).toBe(true)
    await acknowledgeAssignment(address, 'demo_worker')
    expect(await hasUnsettledJobOperation(address)).toBe(false)
  })
})
