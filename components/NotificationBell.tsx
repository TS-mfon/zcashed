'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from './WalletContext'
import { Notification } from '@/lib/types'
import { timeAgo } from '@/lib/utils'
import { Bell, Check } from 'lucide-react'

export function NotificationBell() {
  const { address } = useWallet()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  async function load() {
    if (!address) return
    try {
      const res = await fetch(`/api/notifications?address=${encodeURIComponent(address)}`)
      const data = await res.json()
      setItems(data.notifications ?? [])
      setUnread(data.unread ?? 0)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!address) return
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function markAll() {
    if (!address) return
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true, address }),
    })
    load()
  }

  async function openItem(n: Notification) {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: n.id }),
    })
    setOpen(false)
    if (n.link) router.push(n.link)
    load()
  }

  if (!address) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className="btn btn-ghost"
        style={{ position: 'relative', padding: 8 }}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxWidth: '90vw',
            maxHeight: 440,
            overflowY: 'auto',
            boxShadow: '0 18px 50px rgba(0,0,0,.14)',
            zIndex: 200,
            padding: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
              position: 'sticky',
              top: 0,
              background: 'var(--surface)',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 8px', gap: 4 }}
              >
                <Check size={13} /> Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <Bell size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
              No notifications yet
            </div>
          ) : (
            items.slice(0, 20).map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  background: n.read ? 'transparent' : 'var(--primary-glow)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {!n.read && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        flexShrink: 0,
                        marginTop: 5,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5 }}>{n.body}</div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
