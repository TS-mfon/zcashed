'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from './WalletContext'
import type { Notification } from '@/lib/types'
import { timeAgo } from '@/lib/utils'
import { Bell, Check } from 'lucide-react'

type Snapshot = { owner: string | null; items: Notification[]; error: string }
const empty: Snapshot = { owner: null, items: [], error: '' }
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Notifications could not be updated.'

async function fetchNotifications(signal?: AbortSignal): Promise<Notification[]> {
  const response = await fetch('/api/notifications', { cache: 'no-store', credentials: 'same-origin', signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Notifications could not be loaded.')
  return data.notifications ?? []
}

export function NotificationBell() {
  const { address } = useWallet()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(empty)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const current = snapshot.owner === address ? snapshot : empty
  const unread = current.items.filter((item) => !item.read).length

  useEffect(() => {
    if (!address) return
    const controller = new AbortController()
    async function poll() {
      try {
        const items = await fetchNotifications(controller.signal)
        if (!controller.signal.aborted) setSnapshot({ owner: address, items, error: '' })
      } catch (cause) {
        if (!controller.signal.aborted) setSnapshot((previous) => ({ owner: address,
          items: previous.owner === address ? previous.items : [], error: errorMessage(cause) }))
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [address])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function retry() {
    if (!address || busy) return
    setBusy(true)
    try { setSnapshot({ owner: address, items: await fetchNotifications(), error: '' }) }
    catch (cause) { setSnapshot((previous) => ({ ...previous, error: errorMessage(cause) })) }
    finally { setBusy(false) }
  }

  async function markRead(body: { all: true } | { id: string }, item?: Notification) {
    if (!address || busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/notifications', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'The notification update could not be saved.')
      setSnapshot((previous) => previous.owner === address ? { ...previous, error: '', items: previous.items.map((note) =>
        'all' in body || note.id === body.id ? { ...note, read: true } : note) } : previous)
      if (item) {
        setOpen(false)
        if (item.link.startsWith('/') && !item.link.startsWith('//') && !item.link.includes('\\')) router.push(item.link)
      }
    } catch (cause) {
      setSnapshot((previous) => ({ owner: address, items: previous.owner === address ? previous.items : [], error: errorMessage(cause) }))
    } finally { setBusy(false) }
  }

  if (!address) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} className="btn btn-ghost"
        style={{ position: 'relative', padding: 8, minWidth: 44, minHeight: 44 }}
        aria-label="Notifications" aria-expanded={open} aria-controls={open ? panelId : undefined}>
        <Bell size={18} />
        {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 999, background: '#b91c1c', color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <section id={panelId} aria-label="Notification updates" className="card" style={{ position: 'absolute',
        top: 'calc(100% + 8px)', right: 0, width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 440,
        overflowY: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,.14)', zIndex: 200, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
          {unread > 0 && <button type="button" disabled={busy} onClick={() => { void markRead({ all: true }) }}
            className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', gap: 4, minHeight: 44 }}>
            <Check size={13} /> Mark all read
          </button>}
        </div>
        {current.error && <div style={{ padding: 16 }}><p role="alert" style={{ color: '#b91c1c', fontSize: 13, lineHeight: 1.6 }}>{current.error}</p>
          <button type="button" onClick={() => { void retry() }} disabled={busy} className="btn btn-outline" style={{ marginTop: 12, minHeight: 44 }}>Retry notifications</button></div>}
        {!current.error && current.items.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted-2)', fontSize: 13 }}>
          <Bell size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />No notifications yet
        </div>}
        {current.items.slice(0, 20).map((item) => <button key={item.id} type="button" disabled={busy}
          onClick={() => { void markRead({ id: item.id }, item) }} style={{ display: 'block', width: '100%', textAlign: 'left',
            padding: '12px 16px', background: item.read ? 'transparent' : 'var(--primary-glow)', border: 'none',
            borderBottom: '1px solid var(--border)', cursor: 'pointer', overflowWrap: 'anywhere' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {!item.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: 5 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{item.title}</div>
              {item.body && <div style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5 }}>{item.body}</div>}
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>{timeAgo(item.createdAt)}</div>
            </div>
          </div>
        </button>)}
      </section>}
    </div>
  )
}
