'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { Notification } from '@/lib/types'
import { timeAgo } from '@/lib/utils'
import { Bell, Check, Loader2 } from 'lucide-react'

export default function NotificationsPage() {
  const { address, isConnected, isLoading } = useWallet()
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!address) return
    const res = await fetch(`/api/notifications?address=${encodeURIComponent(address)}`)
    const data = await res.json()
    setItems(data.notifications ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (address) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  async function markAll() {
    if (!address) return
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true, address }),
    })
    load()
  }

  async function open(n: Notification) {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: n.id }),
    })
    if (n.link) router.push(n.link)
  }

  if (isLoading) return <div className="py-20 text-center"><Loader2 className="spin" style={{ margin: '0 auto', color: 'var(--primary)' }} /></div>

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <Bell size={36} style={{ color: 'var(--muted)', margin: '0 auto 14px' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Connect your wallet</h2>
        <p style={{ color: 'var(--muted-2)', marginBottom: 20 }}>Connect to see your notifications.</p>
        <button onClick={() => router.push('/onboarding')} className="btn btn-primary">Connect Wallet</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>Notifications</h1>
        {items.some((n) => !n.read) && (
          <button onClick={markAll} className="btn btn-outline" style={{ fontSize: 13, gap: 6 }}>
            <Check size={14} /> Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 10 }}>{[1, 2, 3].map((i) => <div key={i} className="card shimmer" style={{ height: 72 }} />)}</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <Bell size={36} style={{ color: 'var(--muted)', margin: '0 auto 12px', opacity: 0.5 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No notifications yet</h3>
          <p style={{ color: 'var(--muted-2)', fontSize: 14 }}>You’ll see job updates, applications, and payments here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className="card"
              style={{
                padding: '16px 20px',
                textAlign: 'left',
                cursor: 'pointer',
                border: n.read ? '1px solid var(--border)' : '1px solid var(--primary)',
                background: n.read ? 'var(--surface)' : 'var(--primary-glow)',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              {!n.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: 6 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 13.5, color: 'var(--muted-2)', lineHeight: 1.5 }}>{n.body}</div>}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{timeAgo(n.createdAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
