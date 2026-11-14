'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, ShieldCheck, Wallet, X } from 'lucide-react'
import { BrowserWallet, watchBrowserWallets } from '@/lib/browser-wallet'

type Props = { busy: boolean; error: string; onClose: () => void; onSelect: (wallet: BrowserWallet) => Promise<void> }
export default function WalletPicker({ busy, error, onClose, onSelect }: Props) {
  const [wallets, setWallets] = useState<BrowserWallet[]>([])
  const [selected, setSelected] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => watchBrowserWallets(setWallets), [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab') return
      const targets = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [busy, onClose])
  return <div onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,18,10,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title" tabIndex={-1} className="card" style={{ width: '100%', maxWidth: 460, padding: 24, maxHeight: '90dvh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}><h2 id="wallet-picker-title" style={{ fontSize: 22, fontWeight: 800 }}>Connect Zucchini</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close wallet picker" className="btn btn-ghost" style={{ minHeight: 44, minWidth: 44 }}><X size={20} /></button></div>
      <p style={{ fontSize: 13, color: 'var(--muted-2)', lineHeight: 1.7, marginBottom: 20 }}>Testnet only. Choose Zucchini and approve access to your Unified Account. Payments require a separate approval in your wallet.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        {wallets.map((wallet) => <button type="button" key={wallet.id} disabled={busy} onClick={() => { setSelected(wallet.id); void onSelect(wallet) }} className="btn btn-outline" style={{ minHeight: 62, justifyContent: 'flex-start', padding: 16 }}>
          {busy && selected === wallet.id ? <Loader2 size={20} className="spin" /> : <Wallet size={20} />}<span style={{ flex: 1, textAlign: 'left' }}>{wallet.name}</span><span style={{ fontSize: 11, color: 'var(--muted-2)' }}>Detected</span>
        </button>)}
        {!wallets.length && <div style={{ background: 'var(--surface-2)', padding: 18, borderRadius: 10 }}><h3 style={{ fontWeight: 700, marginBottom: 8 }}>Zucchini is not available to this page</h3><p style={{ fontSize: 13, color: 'var(--muted-2)', lineHeight: 1.7 }}>Unlock Zucchini, enable it for this website, then refresh this page. Opening the wallet in another tab alone may not expose its browser provider here.</p><a href="https://github.com/zucchini-wallet" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ minHeight: 44, marginTop: 14 }}>Zucchini wallet help <ExternalLink size={14} /></a></div>}
      </div>
      {busy && <p role="status" style={{ fontSize: 13, marginTop: 16 }}>Approve testnet account access in Zucchini…</p>}
      {error && <p role="alert" style={{ fontSize: 13, lineHeight: 1.7, color: '#b91c1c', marginTop: 16 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.7 }}><ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 3 }} /><p>Your wallet keeps its spending keys. Your app account is saved in this browser’s secure session. The operator holds job deposits in the custodial testnet vault.</p></div>
    </div>
  </div>
}
