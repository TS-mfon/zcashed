'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Copy, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { Job } from '@/lib/types'
import { buildPaymentRequest, formatZatoshis, parseShieldedAddress } from '@/lib/zcash'
import { useWallet } from './WalletContext'
import { cancellationEligibility, isJobExpired, jobDeadline } from '@/lib/job-lifecycle'
import { validateTextJob } from '@/lib/job-policy'

type Operation = { purpose: 'worker_payout' | 'client_refund'; state: string; txid?: string; confirmations: number; message: string }
type Props = { job: Job; actorAddress: string | null; onChange: () => void | Promise<void> }

function VaultFeeStatus({ jobId, jobStatus }: { jobId: string; jobStatus: Job['status'] }) {
  const [fees, setFees] = useState<{ ready: boolean; shortfallZatoshis: number; pendingPayouts: number } | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/vault-fees`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok || !data.fees) throw new Error(data.error ?? 'Fee status is unavailable.')
        if (!controller.signal.aborted) { setFees(data.fees); setError('') }
      }).catch(cause => { if (!controller.signal.aborted) { setFees(null); setError(cause instanceof Error ? cause.message : 'Fee status is unavailable.') } })
    return () => controller.abort()
  }, [jobId, jobStatus, refresh])
  return <div role="status" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
    {error ? 'Vault fee status unavailable. Releases wait for the operator wallet.' : !fees ? 'Loading vault fee reserve…' : fees.pendingPayouts ? 'A wallet transfer is awaiting confirmation. Further releases wait for confirmation.' : fees.ready ? 'Job deposits are protected. The operator fee reserve is ready.' : `The operator must top up its fee reserve by at least ${formatZatoshis(fees.shortfallZatoshis)} testnet ZEC before release. Your job deposit is protected.`}
    <button type="button" className="btn btn-ghost" onClick={() => setRefresh(value => value + 1)} style={{ marginLeft: 8, fontSize: 12 }}>Refresh fee status</button>
  </div>
}

export default function VaultPanel({ job, actorAddress, onChange }: Props) {
  const { requestWalletPayment, username } = useWallet()
  const client = actorAddress === job.clientAddress
  const worker = !!job.workerAddress && actorAddress === job.workerAddress
  const funded = !!job.fundedAt && job.fundedZatoshis >= job.budgetZatoshis
  const [qr, setQr] = useState<{ uri: string; image: string } | null>(null)
  const [receipt, setReceipt] = useState<{ jobId: string; operation: Operation | null } | null>(null)
  const [payoutAddress, setPayoutAddress] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [walletRequest, setWalletRequest] = useState<{ uri: string; state: 'pending' | 'submitted' | 'uncertain' } | null>(null)
  const operation = receipt?.jobId === job.id ? receipt.operation : null
  const operationLoaded = receipt?.jobId === job.id
  const expired = isJobExpired(job)
  const supported = !validateTextJob(job)
  let canClose = false
  if (client && username && !operation) {
    try { cancellationEligibility(job, supported); canClose = true } catch {}
  }
  const payment = useMemo(() => {
    if (!client || job.status !== 'funding_required' || expired || !supported) return null
    try {
      return buildPaymentRequest({ address: job.vaultAddress, network: 'testnet', amountZatoshis: job.budgetZatoshis, memo: job.vaultReference })
    } catch { return null }
  }, [client, expired, supported, job.status, job.vaultAddress, job.vaultReference, job.budgetZatoshis])

  useEffect(() => {
    if (!payment) return
    let cancelled = false
    import('qrcode').then((module) => module.default.toDataURL(payment.uri, { width: 256, margin: 2, errorCorrectionLevel: 'M' }))
      .then((image) => { if (!cancelled) setQr({ uri: payment.uri, image }) })
      .catch(() => { if (!cancelled) setError('The QR could not be prepared. Use the wallet link or copy the request.') })
    return () => { cancelled = true }
  }, [payment])

  useEffect(() => {
    if (!client && !worker) return
    const controller = new AbortController()
    fetch(`/api/jobs/${encodeURIComponent(job.id)}/claim`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'The private claim state could not be loaded.')
        if (!controller.signal.aborted) setReceipt({ jobId: job.id, operation: data.operation ?? null })
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The claim state could not be loaded.') })
    return () => controller.abort()
  }, [job.id, job.status, client, worker])

  async function action(path: 'funding' | 'claim' | 'refund', body: object) {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/${path}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) {
        // The claim API's 400 responses precede any durable reservation or broadcast.
        // Other failures can occur after a send, so they keep a new claim disabled.
        if (path !== 'funding' && (response.status === 400 || (data.stage === 'prebroadcast' && data.retryable === true))) setSubmitted(false)
        throw new Error(data.error ?? 'The vault action could not be completed.')
      }
      if (path === 'funding') setNotice(data.received ? 'The wallet confirmed your exact deposit. ' + (data.job?.status === 'open' ? 'The job is now open.' : 'The deposit remains available for a client refund.') : 'No confirmed matching deposit yet. Wait for a block and check again.')
      else if (data.operation) setReceipt({ jobId: job.id, operation: data.operation })
      else if (data.operation === null) {
        setReceipt({ jobId: job.id, operation: null })
        setSubmitted(false)
        setAuthorized(false)
        setNotice('The server confirmed that no payout was sent. Review the address and authorize a new request when ready.')
      }
      await onChange()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The vault action could not be completed.') }
    finally { setBusy(false) }
  }

  async function authorizeRelease(event: React.FormEvent, refund = false) {
    event.preventDefault()
    if (busy || submitted || operation || !operationLoaded) return
    try {
      const recipient = parseShieldedAddress(payoutAddress, 'testnet')
      if (recipient.preferredPool !== 'orchard' || !recipient.address.startsWith('utest1')) throw new Error('Use a testnet Unified Address with an Orchard receiver.')
      if (!authorized) throw new Error('Authorize the server wallet payout before claiming.')
      setSubmitted(true)
      await action(refund ? 'refund' : 'claim', refund ? { refundAddress: recipient.address } : { payoutAddress: recipient.address })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check your payout address.') }
  }

  async function copyRequest() {
    if (!payment) return
    try { await navigator.clipboard.writeText(payment.uri); setNotice('Deposit request copied.') }
    catch { setError('Clipboard unavailable. Select and copy the request below.') }
  }

  async function closeJob() {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'The job could not be closed.')
      setNotice(data.message ?? 'Job closed. Authorize a refund to your wallet below.')
      await onChange()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The job could not be closed.') }
    finally { setBusy(false) }
  }

  async function payWithZucchini() {
    if (!payment || walletRequest?.uri === payment.uri || busy) return
    setWalletRequest({ uri: payment.uri, state: 'pending' })
    setError(''); setNotice('')
    try {
      const result = await requestWalletPayment(payment.uri)
      setWalletRequest({ uri: payment.uri, state: 'submitted' })
      setNotice(`Zucchini submitted the deposit (${result.txid}). This is not a confirmed receipt. Wait for a block, then check the confirmed deposit.`)
    } catch (cause) {
      setWalletRequest({ uri: payment.uri, state: 'uncertain' })
      setError((cause instanceof Error ? cause.message : 'The wallet request could not be resolved.') + ' Check Zucchini Activity and the confirmed deposit before making another payment. This page will not resend automatically.')
    }
  }

  if (!job.vaultAddress || job.vaultNetwork !== 'testnet') return null
  return (
    <section className="card" aria-labelledby="vault-heading" style={{ padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <LockKeyhole size={20} aria-hidden="true" />
        <h2 id="vault-heading" style={{ fontSize: 20, fontWeight: 700 }}>Custodial testnet vault</h2>
      </div>
      <p style={{ color: 'var(--muted-2)', fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
        The ZCashed operator controls this native Zcash vault. Deposits and payouts use testnet ZEC and an Orchard receiver.
        GenLayer reviews work; the server wallet signs an authorized worker payout after approval, or a client refund after rejection or cancellation.
      </p>
      <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
        {formatZatoshis(job.budgetZatoshis)} testnet ZEC · {job.status === 'refunded' ? 'Refund confirmed' : job.status === 'refunding' ? 'Refund pending' : job.status === 'completed' ? 'Payout confirmed' : funded ? 'Deposit confirmed' : 'Awaiting deposit'}
      </p>
      {(client || worker) && username && <VaultFeeStatus jobId={job.id} jobStatus={job.status} />}
      {canClose && <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20 }}>
        <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{!supported ? 'This job requires an unsupported deliverable. Close it to request a refund.' : expired ? 'The deadline passed without an approved deliverable. Close the job to request a refund.' : 'You can cancel before a freelancer is assigned. All revisions are due by ' + new Date(jobDeadline(job)).toLocaleString() + '.'}</p>
        <button type="button" className="btn btn-outline" disabled={busy || !operationLoaded} onClick={() => void closeJob()}>{busy ? 'Closing job…' : 'Close job and enable refund'}</button>
      </div>}

      {client && job.status === 'funding_required' && payment && (
        <div>
          <h3 style={{ fontWeight: 700, marginBottom: 8 }}>Fund this job from your existing wallet</h3>
          <p style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
            Send exactly {formatZatoshis(job.budgetZatoshis)} testnet ZEC with the included encrypted memo. Confirm the testnet network,
            full destination, amount and memo in your wallet. Your wallet signs the deposit after you approve it.
            Send each job deposit in its own transaction, without other recipients.
          </p>
          {qr?.uri === payment.uri && <Image src={qr.image} width={256} height={256} unoptimized alt="Testnet Zcash job deposit request QR" style={{ maxWidth: '100%', height: 'auto', margin: '0 auto 16px' }} />}
          <div className="flex flex-wrap gap-3" style={{ marginBottom: 16 }}>
            <button type="button" onClick={() => { void payWithZucchini() }} disabled={busy || walletRequest?.uri === payment.uri} className="btn btn-primary" style={{ minHeight: 44 }}>{walletRequest?.uri === payment.uri ? walletRequest.state === 'pending' ? 'Approve in Zucchini…' : 'Wallet request sent · check Activity' : 'Pay deposit with Zucchini'}</button>
            <a href={payment.uri} className="btn btn-outline" style={{ minHeight: 44 }}>Open deposit URI</a>
            <button type="button" className="btn btn-outline" onClick={copyRequest} style={{ minHeight: 44 }}><Copy size={15} /> Copy request</button>
          </div>
          <label htmlFor="vault-request" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Testnet deposit request</label>
          <textarea id="vault-request" readOnly value={payment.uri} rows={4} style={{ width: '100%', fontSize: 11, padding: 12, overflowWrap: 'anywhere' }} />
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('funding', {})} style={{ minHeight: 44, marginTop: 16 }}>
            <ShieldCheck size={16} /> {busy ? 'Checking the wallet…' : 'Check confirmed deposit'}
          </button>
          <p style={{ color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7, marginTop: 12 }}>The job opens after the vault receives the exact amount and unique memo in a confirmed shielded transaction. Each transaction funds one job. The payment request itself does not confirm funds.</p>
        </div>
      )}
      {client && job.status === 'funding_required' && !payment && !expired && supported && <p role="alert">The stored vault request is invalid. Contact the operator before sending funds.</p>}
      {client && ['cancelled', 'rejected'].includes(job.status) && !funded && (
        <div>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>If you sent a deposit before the job closed, check the wallet for its confirmed receipt. The job will stay closed, and a verified deposit can be refunded.</p>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('funding', {})} style={{ minHeight: 44, marginTop: 12 }}>Check for a late deposit</button>
        </div>
      )}
      {worker && job.status === 'approved' && funded && !operation && !submitted && (
        <form onSubmit={(event) => authorizeRelease(event)} style={{ display: 'grid', gap: 16 }}>
          <label htmlFor="vault-payout" style={{ fontWeight: 600, fontSize: 14 }}>Your private testnet payout address</label>
          <textarea id="vault-payout" value={payoutAddress} onChange={(event) => setPayoutAddress(event.target.value)} required autoComplete="off" spellCheck={false} maxLength={1023} placeholder="utest1…" rows={3} style={{ width: '100%', padding: 12, fontSize: 12, overflowWrap: 'anywhere' }} />
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.7 }}>
            <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} style={{ marginTop: 5 }} />
            I verified this address in my wallet and authorize the server wallet to send this job’s full testnet ZEC budget to it.
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !authorized || !operationLoaded} style={{ minHeight: 44 }}>Claim approved payout</button>
          <p style={{ color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7 }}>Your payout address and receipt stay in private server records. The operator pays wallet-calculated fees from its funded shielded account. Approval makes the payout claimable; this button requests the actual wallet transaction.</p>
        </form>
      )}
      {client && ['cancelled', 'rejected'].includes(job.status) && funded && !operation && !submitted && (
        <form onSubmit={(event) => authorizeRelease(event, true)} style={{ display: 'grid', gap: 16 }}>
          <label htmlFor="vault-refund" style={{ fontWeight: 600, fontSize: 14 }}>Your private testnet refund address</label>
          <textarea id="vault-refund" value={payoutAddress} onChange={(event) => setPayoutAddress(event.target.value)} required autoComplete="off" spellCheck={false} maxLength={1023} placeholder="utest1…" rows={3} style={{ width: '100%', padding: 12, fontSize: 12, overflowWrap: 'anywhere' }} />
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.7 }}>
            <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} style={{ marginTop: 5 }} />
            I verified this address in my wallet and authorize the server wallet to refund this job’s full deposit to it.
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !authorized || !operationLoaded} style={{ minHeight: 44 }}>Refund my closed job</button>
          <p style={{ color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7 }}>Refunds require your approval and use the same reservation as worker payouts. A job cannot be paid and refunded twice. The operator pays wallet-calculated fees.</p>
        </form>
      )}
      {(client || worker) && operation && (
        <div aria-live="polite" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>{operation.purpose === 'client_refund' ? 'Refund' : 'Payout'} {operation.state === 'confirmed' ? 'confirmed' : 'reservation: ' + operation.state}</p>
          <p style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.7 }}>{operation.message}</p>
          {operation.txid && <p style={{ fontSize: 12, overflowWrap: 'anywhere', marginTop: 12 }}>Private wallet receipt: <code>{operation.txid}</code> · {operation.confirmations} confirmation(s)</p>}
        </div>
      )}
      {worker && operation?.purpose !== 'client_refund' && (submitted || job.status === 'claiming' || operation) && (
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('claim', {})} style={{ minHeight: 44, marginTop: 16 }}>{busy ? 'Checking payout…' : 'Check payout confirmation'}</button>
      )}
      {client && (operation?.purpose === 'client_refund' || job.status === 'refunding' || (submitted && ['cancelled', 'rejected'].includes(job.status))) && (
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('refund', {})} style={{ minHeight: 44, marginTop: 16 }}>{busy ? 'Checking refund…' : 'Check refund confirmation'}</button>
      )}
      {worker && submitted && !operation && <p style={{ fontSize: 13, marginTop: 12 }}>The payout request is pending resolution. Keep this page open and check its confirmation; a new payout request is disabled.</p>}
      {client && submitted && !operation && <p style={{ fontSize: 13, marginTop: 12 }}>The refund request is pending resolution. Check its confirmation; a new refund request is disabled.</p>}
      {notice && <p role="status" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 16 }}>{notice}</p>}
      {error && <p role="alert" style={{ fontSize: 13, lineHeight: 1.7, color: '#b91c1c', marginTop: 16 }}>{error}</p>}
    </section>
  )
}
