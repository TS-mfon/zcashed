import { createClient, createAccount, chains } from 'genlayer-js'
import fs from 'fs'

const pk = fs.readFileSync('.env.local', 'utf-8').match(/GENLAYER_PRIVATE_KEY=["']?(0x[0-9a-fA-F]+)/)[1]
const client = createClient({ chain: chains.studionet, account: createAccount(pk) })
const code = fs.readFileSync('contracts/escrow.py', 'utf-8')

const LEADER_ONLY = process.env.LEADER_ONLY === '1'
console.log('leaderOnly:', LEADER_ONLY)

async function waitAccepted(hash, label) {
  const r = await client.waitForTransactionReceipt({ hash, status: 'ACCEPTED', retries: 90, interval: 3000 })
  const lr = r?.consensus_data?.leader_receipt?.[0]
  console.log(`  ${label}: ${r?.status_name}/${r?.result_name} exec=${lr?.execution_result}`)
  if (lr?.execution_result === 'ERROR') {
    console.log('    err node:', lr?.node_config?.address)
    console.log('    genvm_result:', JSON.stringify(lr?.genvm_result)?.slice(0, 300))
    console.log('    result:', JSON.stringify(lr?.result)?.slice(0, 300))
  }
  return r
}

async function main() {
  console.log('Deploy…')
  const dtx = await client.deployContract({ code, args: ['Haiku task', 'Write a 3-line 5-7-5 haiku about Zcash privacy.', '0.1', 'tmC', 'tmE'], leaderOnly: LEADER_ONLY })
  const dr = await client.waitForTransactionReceipt({ hash: dtx, status: 'ACCEPTED' })
  const addr = dr?.data?.contract_address
  console.log('contract:', addr, 'deploy exec:', dr?.consensus_data?.leader_receipt?.[0]?.execution_result)

  // try reading schema to confirm contract is live
  try {
    const schema = await client.getContractSchema({ address: addr })
    console.log('schema methods:', Object.keys(schema?.methods ?? schema ?? {}).slice(0, 10))
  } catch (e) { console.log('schema err:', (e.message || '').split('\n')[0].slice(0, 70)) }

  console.log('accept_job…')
  const atx = await client.writeContract({ address: addr, functionName: 'accept_job', args: ['tmW'], value: 0n, leaderOnly: LEADER_ONLY })
  await waitAccepted(atx, 'accept')

  console.log('submit_work…')
  const stx = await client.writeContract({ address: addr, functionName: 'submit_work', args: ['Shielded and free / Zcash hides the coins I move / No eyes on my spend', 'tmW'], value: 0n, leaderOnly: LEADER_ONLY })
  const sr = await waitAccepted(stx, 'submit')
  const lr = sr?.consensus_data?.leader_receipt?.[0]
  console.log('submit return (calldata/result):', JSON.stringify(lr?.result)?.slice(0, 400))

  console.log('read get_state…')
  try {
    const s = await client.readContract({ address: addr, functionName: 'get_state', args: [] })
    console.log('STATE status:', s?.status, '| reason:', s?.rejection_reason)
  } catch (e) { console.log('read err:', (e.message || '').split('\n')[0].slice(0, 70)) }
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message || e); process.exit(1) })
