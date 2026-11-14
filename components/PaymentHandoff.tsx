'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { AlertCircle, Copy, Wallet } from 'lucide-react'
import { buildPaymentRequest, createCorrelationMemo, formatZatoshis, PaymentRequest, ZcashNetwork } from '../lib/zcash'

export default function PaymentHandoff({ amountZatoshis }: { amountZatoshis: number }) {
  const [network, setNetwork] = useState<ZcashNetwork>('testnet')
  const [recipient, setRecipient] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [request, setRequest] = useState<PaymentRequest | null>(null)
  const [qr, setQr] = useState<{ uri: string; value: string } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!request) return
    let cancelled = false
    QRCode.toDataURL(request.uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((value) => { if (!cancelled) setQr({ uri: request.uri, value }) })
      .catch(() => { if (!cancelled) setError('The QR could not be generated. Copy the payment request or open your wallet.') })
    return () => { cancelled = true }
  }, [request])

  function resetRequest() {
    setRequest(null)
    setQr(null)
    setConfirmed(false)
    setCopied(false)
    setError('')
  }

  function prepareRequest(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!confirmed) {
      setError('Confirm the address with the recipient through a trusted private channel first.')
      return
    }
    try {
      const payment = buildPaymentRequest({ address: recipient, network, amountZatoshis, memo: createCorrelationMemo() })
      setRequest(payment)
      setQr(null)
      setCopied(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare the wallet request.')
    }
  }

  async function copyRequest() {
    if (!request) return
    try {
      await navigator.clipboard.writeText(request.uri)
      setCopied(true)
    } catch {
      setError('Clipboard unavailable. Select and copy the payment request below.')
    }
  }

  return (
    <section className="card" aria-labelledby="payment-heading" style={{ padding: 24, marginBottom: 20 }}>
      <h2 id="payment-heading" style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pay from your Zcash wallet</h2>
      <p style={{ color: 'var(--muted-2)', fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>
        Work is approved and awaiting the payer’s wallet. Get the freelancer’s shielded address privately;
        the address and request stay in this browser. Your sign-in identity is separate from this payout wallet.
      </p>
      <form onSubmit={prepareRequest} style={{ display: 'grid', gap: 16 }}>
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div><span style={{ color: 'var(--muted-2)', fontSize: 13 }}>Requested amount</span><div style={{ fontWeight: 700, fontSize: 22 }}>{formatZatoshis(amountZatoshis)} ZEC</div></div>
          <div>
            <label htmlFor="payment-network" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Zcash network</label>
            <select id="payment-network" value={network} onChange={(event) => { resetRequest(); setNetwork(event.target.value as ZcashNetwork) }} style={{ padding: '10px 12px' }}>
              <option value="testnet">Testnet · demo funds</option>
              <option value="mainnet">Mainnet · real ZEC</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="payment-recipient" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 }}>Recipient shielded address</label>
          <textarea id="payment-recipient" value={recipient} autoComplete="off" spellCheck={false} maxLength={1023}
            onChange={(event) => { resetRequest(); setRecipient(event.target.value) }}
            placeholder={network === 'testnet' ? 'utest1… or ztestsapling1…' : 'u1… or zs1…'}
            style={{ width: '100%', padding: '12px 14px', fontSize: 13, minHeight: 90, overflowWrap: 'anywhere' }} />
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Sapling and revision 0 Unified Addresses containing only Sapling or Orchard receivers are supported.</p>
        </div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.6 }}>
          <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setRequest(null); setQr(null) }} style={{ marginTop: 4 }} />
          I confirmed this address and network with the recipient through a trusted private channel.
        </label>
        <button type="submit" className="btn btn-primary" style={{ minHeight: 44 }}><Wallet size={16} /> Prepare wallet request</button>
      </form>
      {error && <p role="alert" style={{ display: 'flex', gap: 8, fontSize: 13, color: '#b91c1c', marginTop: 16 }}><AlertCircle size={16} style={{ flexShrink: 0 }} />{error}</p>}
      {request && request.amountZatoshis === amountZatoshis && (
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Preferred receiver: {request.preferredPool === 'orchard' ? 'Orchard' : 'Sapling'} · {request.network}</p>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', lineHeight: 1.7, marginBottom: 16 }}>
            Your wallet chooses a supported shielded receiver. Confirm the actual pool, complete recipient, amount, memo, and fee in your wallet.
            Use already-shielded funds for a private transfer. The transaction is signed locally by your wallet only after you approve it.
          </p>
          {qr?.uri === request.uri && <Image src={qr.value} width={280} height={280} unoptimized alt="Zcash wallet payment request QR code" style={{ maxWidth: '100%', height: 'auto', margin: '0 auto 16px' }} />}
          <div className="flex flex-wrap gap-3" style={{ marginBottom: 16 }}>
            <a href={request.uri} className="btn btn-primary" style={{ minHeight: 44 }}>Open in Zcash wallet</a>
            <button type="button" onClick={copyRequest} className="btn btn-outline" style={{ minHeight: 44 }}><Copy size={15} /> {copied ? 'Request copied' : 'Copy request'}</button>
          </div>
          <label htmlFor="payment-uri" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Private payment request</label>
          <textarea id="payment-uri" value={request.uri} readOnly rows={4} style={{ width: '100%', fontSize: 11, padding: 12, overflowWrap: 'anywhere' }} />
          <p style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.7, marginTop: 12 }}>
            This request does not confirm payment. Check sender and recipient wallet evidence for the received amount and encrypted memo.
            GenLayer records the work verdict; it cannot release Zcash funds. Keep this request private. The memo contains only an opaque work reference.
          </p>
        </div>
      )}
    </section>
  )
}
