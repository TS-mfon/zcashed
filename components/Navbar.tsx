'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useWallet } from './WalletContext'
import { NotificationBell } from './NotificationBell'
import { shortenAddress } from '@/lib/utils'
import { useState } from 'react'
import { Zap, Menu, X } from 'lucide-react'

export function Navbar() {
  const { address, isConnected, clearWallet, role } = useWallet()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const links = [
    { href: '/jobs', label: 'Explore Jobs' },
    { href: '/jobs/new', label: 'Post a Job' },
    { href: '/dashboard', label: 'Dashboard' },
    ...(role === 'admin' ? [{ href: '/admin', label: 'Admin' }] : []),
  ]

  function isActive(href: string) {
    return pathname === href || (href !== '/' && pathname.startsWith(href + '/'))
  }

  return (
    <nav
      style={{
        background: 'rgba(255, 255, 255, 0.85)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(14px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        className="max-w-7xl mx-auto px-4"
        style={{ display: 'flex', alignItems: 'center', height: 66, gap: 20 }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-lg"
          style={{ color: 'var(--text)', textDecoration: 'none', flexShrink: 0 }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              background: 'linear-gradient(135deg, var(--primary), #ffd94d)',
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px var(--primary-glow)',
            }}
          >
            <Zap size={19} color="#1a1500" strokeWidth={2.6} fill="#1a1500" />
          </div>
          ZCashed
        </Link>

        <div className="hidden md:flex items-center gap-1 flex-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="btn btn-ghost"
              style={{
                color: isActive(link.href) ? 'var(--primary-dark)' : 'var(--muted-2)',
                fontWeight: isActive(link.href) ? 700 : 500,
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2 ml-auto">
          {isConnected ? (
            <>
              <NotificationBell />
              <Link
                href="/profile"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: 13,
                  fontFamily: 'var(--font-geist-mono)',
                  color: 'var(--muted-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textDecoration: 'none',
                }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }}
                />
                {shortenAddress(address!, 6)}
                {role && (
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      background: 'var(--primary)',
                      color: 'var(--primary-ink)',
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontFamily: 'var(--font-geist-sans)',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {role}
                  </span>
                )}
              </Link>
              <button onClick={clearWallet} className="btn btn-ghost" style={{ fontSize: 13 }}>
                Logout
              </button>
            </>
          ) : (
            <button onClick={() => router.push('/onboarding')} className="btn btn-primary" style={{ fontSize: 13 }}>
              Connect Wallet
            </button>
          )}
        </div>

        <button
          className="md:hidden btn btn-ghost ml-auto"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: 16 }}
          className="md:hidden"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block"
              onClick={() => setMobileOpen(false)}
              style={{
                padding: '12px 8px',
                color: isActive(link.href) ? 'var(--primary-dark)' : 'var(--text)',
                textDecoration: 'none',
                borderBottom: '1px solid var(--border)',
                fontWeight: 600,
              }}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-4">
            {isConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Link
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  style={{
                    fontSize: 13,
                    color: 'var(--muted-2)',
                    fontFamily: 'var(--font-geist-mono)',
                    textDecoration: 'none',
                  }}
                >
                  {address}
                </Link>
                <Link href="/notifications" onClick={() => setMobileOpen(false)} className="btn btn-outline w-full">
                  Notifications
                </Link>
                <button onClick={clearWallet} className="btn btn-ghost w-full">
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  router.push('/onboarding')
                  setMobileOpen(false)
                }}
                className="btn btn-primary w-full"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
