'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import type { Notification } from '@/lib/types'
import { timeAgo } from '@/lib/utils'
import { Bell, Check, Loader2, ArrowUpRight } from 'lucide-react'

export default function NotificationsPage() {
  const { address, isConnected, isLoading } = useWallet()
  const router = useRouter()
  if (isLoading) return <Loading />
  if (!isConnected) return <div className="max-w-xl mx-auto px-4 py-20 text-center">
    <Bell size={36} style={{ color: 'var(--primary-dark)', margin: '0 auto 18px' }} />
    <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>Your work updates</h1>
    <p style={{ color: 'var(--muted-2)', marginBottom: 24 }}>Connect your existing wallet to see updates for your jobs and applications.</p>
    <button onClick={() => router.push('/onboarding')} className="btn btn-primary">Connect wallet</button>
  </div>
  return <NotificationContent key={address} />
}

function NotificationContent() {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const unread = items.filter((item) => !item.read).length

  useEffect(() => {
    const controller = new AbortController()
    readNotifications(controller.signal)
      .then((notifications) => { if (!controller.signal.aborted) setItems(notifications) })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function retry() {
    setLoading(true)
    setError('')
    try { setItems(await readNotifications()) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  async function markAll() {
    setPending('all')
    setError('')
    try {
      await markRead({ all: true })
      setItems((current) => current.map((item) => ({ ...item, read: true })))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setPending(null) }
  }
  async function open(item: Notification) {
    setPending(item.id)
    setError('')
    try {
      if (!item.read) await markRead({ id: item.id })
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry))
      if (item.link && safeInternalLink(item.link)) router.push(item.link)
      else if (item.link) setError('This update has no valid internal destination.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setPending(null) }
  }

  return <div className="max-w-2xl mx-auto px-4 py-10">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 26 }}>
      <div><h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 6 }}>Notifications</h1><p style={{ color: 'var(--muted-2)', fontSize: 14 }}>{loading ? 'Loading your updates' : unread ? `${unread} unread` : 'All caught up'}</p></div>
      {unread > 0 && <button onClick={markAll} disabled={pending !== null || loading} className="btn btn-outline" style={{ fontSize: 13 }}>{pending === 'all' ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{pending === 'all' ? 'Marking read…' : 'Mark all read'}</button>}
    </div>
    {error && <div role="alert" className="card" style={{ borderColor: '#b45309', padding: 16, marginBottom: 20 }}><p style={{ marginBottom: 12, lineHeight: 1.6 }}>{error}</p><button onClick={retry} disabled={loading || pending !== null} className="btn btn-outline">Try again</button></div>}
    {loading ? <Loading /> : items.length === 0 && !error ? <div className="card" style={{ padding: '48px 28px', textAlign: 'center' }}>
      <Bell size={32} style={{ color: 'var(--primary-dark)', margin: '0 auto 18px' }} />
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No updates yet</h2>
      <p style={{ color: 'var(--muted-2)', fontSize: 14, lineHeight: 1.7 }}>Job assignments, review results, and confirmed vault changes will appear here.</p>
    </div> : <ul style={{ display: 'grid', gap: 12, listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((item) => <li key={item.id}><button onClick={() => open(item)} disabled={pending !== null} className="card" aria-label={`${item.read ? 'Read' : 'Unread'}: ${item.title}`}
        style={{ width: '100%', padding: '20px 22px', textAlign: 'left', cursor: pending ? 'wait' : 'pointer', borderColor: item.read ? 'var(--border)' : 'var(--primary)', background: item.read ? 'var(--surface)' : 'var(--surface-2)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{item.title}</span>{!item.read && <span className="badge" style={{ background: 'var(--primary)', color: 'var(--primary-ink)', fontSize: 10, borderColor: 'transparent' }}>Unread</span>}</span>
          {item.body && <span style={{ display: 'block', fontSize: 14, color: 'var(--muted-2)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{item.body}</span>}
          <time dateTime={item.createdAt} style={{ display: 'block', fontSize: 12, color: 'var(--muted-2)', marginTop: 10 }}>{timeAgo(item.createdAt)}</time>
        </span>
        {pending === item.id ? <Loader2 size={18} className="spin" /> : item.link && <ArrowUpRight size={18} style={{ flexShrink: 0 }} />}
      </button></li>)}
    </ul>}
  </div>
}
function Loading() {
  return <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 16px', color: 'var(--muted-2)' }}><Loader2 className="spin" size={20} />Loading your updates…</div>
}
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Could not update notifications. Please try again.' }
function safeInternalLink(link: string): boolean { return /^\/(?![\/\\])/.test(link) && !/[\\\u0000-\u001f]/.test(link) }
async function readNotifications(signal?: AbortSignal): Promise<Notification[]> {
  const response = await fetch('/api/notifications', { signal, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not load notifications. Please try again.')
  if (!Array.isArray(data.notifications)) throw new Error('The server returned an invalid notification list. Please try again.')
  return data.notifications
}
async function markRead(body: { all: true } | { id: string }): Promise<void> {
  const response = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok || data.ok !== true) throw new Error(typeof data.error === 'string' ? data.error : 'Could not mark updates read. Please try again.')
}
