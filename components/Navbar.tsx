'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, Loader2, Menu, X, Zap } from 'lucide-react'
import { useWallet } from './WalletContext'

export function Navbar() {
  const { isConnected, clearWallet, role, profile, error, openWalletPicker } = useWallet()
  const pathname = usePathname()
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [localError, setLocalError] = useState('')
  const toggle = useRef<HTMLButtonElement>(null)
  const mobileOpen = menuPath === pathname
  const links = [{ href: '/jobs', label: 'Find work' }, { href: '/jobs/new', label: 'Post a job' },
    { href: '/dashboard', label: 'Dashboard' }, ...(role === 'admin' ? [{ href: '/admin', label: 'Admin' }] : [])]

  useEffect(() => {
    if (!mobileOpen) return
    function close(event: KeyboardEvent) {
      if (event.key === 'Escape') { setMenuPath(null); toggle.current?.focus() }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [mobileOpen])

  function active(href: string) {
    if (pathname === '/jobs/new') return href === '/jobs/new'
    return pathname === href || pathname.startsWith(href + '/')
  }
  async function disconnect() {
    setDisconnecting(true)
    setLocalError('')
    try { await clearWallet() }
    catch { setLocalError('Could not disconnect. Please try again.') }
    finally { setDisconnecting(false) }
  }
  const accountActions = <>
    <Link href="/notifications" className="btn btn-ghost" onClick={() => setMenuPath(null)} aria-label="Notifications"><Bell size={19} /><span className="lg:hidden">Notifications</span></Link>
    <Link href="/profile" className="btn btn-outline nav-profile" onClick={() => setMenuPath(null)}><span>{profile?.displayName || 'Your profile'}</span></Link>
    <button onClick={disconnect} disabled={disconnecting} className="btn btn-ghost">{disconnecting ? <Loader2 size={16} className="spin" /> : null}{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
  </>

  return <nav aria-label="Main navigation" className="site-nav">
    <div className="max-w-7xl mx-auto px-4 nav-inner">
      <Link href="/" className="nav-brand" aria-label="ZCashed home">
        <span className="nav-logo"><Zap size={21} strokeWidth={2.5} fill="currentColor" /></span>ZCashed
      </Link>
      <span className="nav-network hidden xl:inline-flex">Testnet vault</span>
      <div className="hidden lg:flex items-center gap-1 flex-1">
        {links.map((link) => <Link key={link.href} href={link.href} className={`btn btn-ghost ${active(link.href) ? 'nav-active' : ''}`} aria-current={active(link.href) ? 'page' : undefined}>{link.label}</Link>)}
      </div>
      <div className="hidden lg:flex items-center gap-2 ml-auto">
        {isConnected ? accountActions : <button type="button" onClick={openWalletPicker} className="btn btn-primary">Connect wallet</button>}
      </div>
      <button ref={toggle} className="lg:hidden btn btn-ghost ml-auto" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMenuPath(mobileOpen ? null : pathname)}>
        {mobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>
    </div>
    {mobileOpen && <div id="mobile-navigation" className="lg:hidden mobile-navigation">
      {links.map((link) => <Link key={link.href} href={link.href} aria-current={active(link.href) ? 'page' : undefined} className={`mobile-nav-link ${active(link.href) ? 'nav-active' : ''}`} onClick={() => setMenuPath(null)}>{link.label}</Link>)}
      <div className="mobile-account-actions">{isConnected ? accountActions : <button type="button" className="btn btn-primary" onClick={() => { setMenuPath(null); openWalletPicker() }}>Connect wallet</button>}</div>
      <p className="nav-network">Existing wallet login · Custodial testnet vault</p>
    </div>}
    {(localError || error) && <p role="alert" className="nav-error">{localError || error}</p>}
  </nav>
}
