import { createClient, createAccount, chains } from 'genlayer-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8')
const pk = envText.match(/GENLAYER_PRIVATE_KEY=["']?(0x[0-9a-fA-F]+)["']?/)?.[1]
if (!pk) throw new Error('GENLAYER_PRIVATE_KEY not found')

const account = createAccount(pk)
const client = createClient({ chain: chains.studionet, account })
console.log('Account:', account.address)
const code = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'escrow.py'), 'utf-8')

// wait for FINALIZED, tolerant of transient network errors
async function waitFinal(hash, label) {
  const t0 = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await client.waitForTransactionReceipt({ hash, status: 'FINALIZED', retries: 80, interval: 3000 })
      console.log(`  ${label}: FINALIZED in ${((Date.now() - t0) / 1000).toFixed(0)}s (result: ${r?.result_name})`)
      return r
    } catch (e) {
      if (/fetch failed|unknown RPC/i.test(e.message || '') && attempt < 3) {
        console.log(`  ${label}: transient error, retrying…`)
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      throw e
    }
  }
}

async function read(contractAddress) {
  for (let i = 0; i < 5; i++) {
    try {
      return await client.readContract({ address: contractAddress, functionName: 'get_state', args: [] })
    } catch (e) {
      if (i < 4) { await new Promise((r) => setTimeout(r, 3000)); continue }
      throw e
    }
  }
}

async function main() {
  console.log('\n=== Deploy ===')
  const deployTx = await client.deployContract({
    code,
    args: ['Write a haiku about Zcash', 'Write a 3-line haiku (5-7-5) about Zcash privacy.', '0.1', 'tmClient', 'tmEscrow'],
    leaderOnly: false,
  })
  console.log('deploy tx:', deployTx)
  const dr = await client.waitForTransactionReceipt({ hash: deployTx, status: 'ACCEPTED' })
  const contractAddress = dr?.data?.contract_address
  console.log('contract:', contractAddress)
  await waitFinal(deployTx, 'deploy')

  console.log('\n=== read initial state ===')
  const s0 = await read(contractAddress)
  console.log('status:', s0?.status, '| title:', s0?.task_title)

  console.log('\n=== accept_job ===')
  const at = await client.writeContract({ address: contractAddress, functionName: 'accept_job', args: ['tmWorker'], value: 0n, leaderOnly: false })
  await waitFinal(at, 'accept')

  console.log('\n=== submit_work (REAL AI) ===')
  const st = await client.writeContract({
    address: contractAddress, functionName: 'submit_work',
    args: ['Shielded and free / Zcash guards the coins I send / No eyes trace my spend', 'tmWorker'],
    value: 0n, leaderOnly: false,
  })
  await waitFinal(st, 'submit')

  console.log('\n=== final state ===')
  const s1 = await read(contractAddress)
  console.log('STATUS:', s1?.status)
  console.log('AI REASON:', s1?.rejection_reason || '(approved — no revision needed)')
  console.log('submissions:', s1?.submission_count)
}

main().then(() => { console.log('\n✅ DONE'); process.exit(0) }).catch((e) => { console.error('\n❌', e.message || e); process.exit(1) })
