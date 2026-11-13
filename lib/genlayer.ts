import { createClient, createAccount, generatePrivateKey, chains } from 'genlayer-js'
import fs from 'fs'
import path from 'path'

const PRIVATE_KEY_FILE = path.join(process.cwd(), 'data', '.genlayer_key')

function getOrCreatePrivateKey(): `0x${string}` {
  const envKey = process.env.GENLAYER_PRIVATE_KEY
  if (envKey) return envKey as `0x${string}`

  if (fs.existsSync(PRIVATE_KEY_FILE)) {
    const key = fs.readFileSync(PRIVATE_KEY_FILE, 'utf-8').trim()
    if (key.startsWith('0x') && key.length === 66) return key as `0x${string}`
  }

  const newKey = generatePrivateKey()
  if (!fs.existsSync(path.dirname(PRIVATE_KEY_FILE))) {
    fs.mkdirSync(path.dirname(PRIVATE_KEY_FILE), { recursive: true })
  }
  fs.writeFileSync(PRIVATE_KEY_FILE, newKey)
  return newKey
}

function getClient() {
  const privateKey = getOrCreatePrivateKey()
  const account = createAccount(privateKey)
  return createClient({
    chain: chains.studionet,
    account,
  })
}

function getContractCode(): string {
  const contractPath = path.join(process.cwd(), 'contracts', 'escrow.py')
  return fs.readFileSync(contractPath, 'utf-8')
}

export async function deployEscrowContract(params: {
  taskTitle: string
  taskDescription: string
  budgetZec: string
  clientAddress: string
  escrowZcashAddress: string
}): Promise<string> {
  const client = getClient()
  const code = getContractCode()

  const txHash = await client.deployContract({
    code,
    args: [
      params.taskTitle,
      params.taskDescription,
      params.budgetZec,
      params.clientAddress,
      params.escrowZcashAddress,
    ],
    leaderOnly: false,
  })

  const receipt = await client.waitForTransactionReceipt({ hash: txHash as any })
  return (receipt as any).contractAddress as string
}

export async function acceptJobOnChain(
  contractAddress: string,
  workerAddress: string,
): Promise<string> {
  const client = getClient()

  const txHash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: 'accept_job',
    args: [workerAddress],
    value: 0n,
    leaderOnly: false,
  })

  await client.waitForTransactionReceipt({ hash: txHash as any })
  return txHash as string
}

export async function submitWorkOnChain(
  contractAddress: string,
  submissionContent: string,
  workerAddress: string,
): Promise<{ txHash: string; approved: boolean; rejectionReason: string }> {
  const client = getClient()

  const txHash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: 'submit_work',
    args: [submissionContent, workerAddress],
    value: 0n,
    leaderOnly: false,
  })

  await client.waitForTransactionReceipt({ hash: txHash as any })

  // Read state after submission to get AI verdict
  const state = await readContractState(contractAddress)
  const approved = state.status === 'approved'
  const rejectionReason = state.rejection_reason ?? ''

  return { txHash: txHash as string, approved, rejectionReason }
}

export async function markPaidOnChain(
  contractAddress: string,
  txHash: string,
): Promise<string> {
  const client = getClient()

  const hash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: 'mark_paid',
    args: [txHash],
    value: 0n,
    leaderOnly: false,
  })

  await client.waitForTransactionReceipt({ hash: hash as any })
  return hash as string
}

export async function readContractState(contractAddress: string): Promise<Record<string, any>> {
  const client = getClient()

  const result = await client.readContract({
    address: contractAddress as `0x${string}`,
    functionName: 'get_state',
    args: [],
    jsonSafeReturn: true,
  })

  return (result ?? {}) as Record<string, any>
}

export function getGenLayerAccount(): string {
  const privateKey = getOrCreatePrivateKey()
  const account = createAccount(privateKey)
  return account.address
}
