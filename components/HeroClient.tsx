'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Globe } from './Globe'
import { ArrowRight, Zap } from 'lucide-react'

export function HeroClient() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const root = document.getElementById('hero-root')
    if (!root || reduced) return
    root.classList.add('anim-ready')
    const start = () => {
      root.classList.remove('anim-ready')
      root.classList.add('anim-go')
    }
    const t = setTimeout(start, 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <section
      id="hero-root"
      style={{
        minHeight: 'calc(100vh - 66px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Globe background */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -52%)',
          width: 'min(820px, 115vw)',
          height: 'min(820px, 115vw)',
          pointerEvents: 'none',
        }}
        className="float"
      >
        <Globe style={{ width: '100%', height: '100%' }} />
      </div>

      {/* radial fade so text reads */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.4) 45%, rgba(255,255,255,0.85) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        className="max-w-5xl mx-auto px-4 text-center"
        style={{ position: 'relative', zIndex: 2, paddingTop: 40, paddingBottom: 60 }}
      >
        <div className="hero-badge" style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: 'rgba(245,184,0,0.12)',
              border: '1px solid rgba(245,184,0,0.4)',
              borderRadius: 999,
              padding: '7px 16px',
              fontSize: 13,
              color: 'var(--primary-dark)',
              fontWeight: 600,
            }}
          >
            <Zap size={14} fill="currentColor" />
            GenLayer AI · Zcash Privacy
          </span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(44px, 8vw, 92px)',
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          <span className="hero-line">
            <span className="hero-line-i" style={{ color: 'var(--text)' }}>
              Hire anyone.
            </span>
          </span>
          <span className="hero-line">
            <span className="hero-line-i gradient-text">Pay privately.</span>
          </span>
        </h1>

        <p
          className="hero-sub"
          style={{
            fontSize: 'clamp(16px, 2.2vw, 19px)',
            color: 'var(--muted-2)',
            maxWidth: 580,
            margin: '22px auto 0',
            lineHeight: 1.7,
            fontWeight: 400,
          }}
        >
          The freelance marketplace where <strong style={{ color: 'var(--text)' }}>AI judges the work</strong> and
          payments settle through <strong style={{ color: 'var(--text)' }}>private Zcash escrow</strong>. No
          arbitrators. No exposed transactions.
        </p>

        <div
          className="hero-ctas"
          style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          <Link href="/onboarding" className="btn btn-primary" style={{ fontSize: 15, padding: '13px 28px' }}>
            Get Started <ArrowRight size={16} />
          </Link>
          <Link href="/jobs" className="btn btn-outline" style={{ fontSize: 15, padding: '13px 28px' }}>
            Explore Jobs
          </Link>
        </div>
      </div>

      {/* scroll hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          color: 'var(--muted)',
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
        className="pulse"
      >
        Scroll ↓
      </div>
    </section>
  )
}
