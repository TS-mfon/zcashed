'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { JobCard } from '@/components/JobCard'
import { Job, Application } from '@/lib/types'
import { formatZec, shortenAddress, timeAgo } from '@/lib/utils'
import { Plus, Briefcase, ExternalLink, Info, Loader2, Send } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
  const { address, isConnected, isLoading, role, profile } = useWallet()
  const router = useRouter()

  const [posted, setPosted] = useState<Job[]>([])
  const [working, setWorking] = useState<Job[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'posted' | 'working' | 'applications'>(role === 'client' ? 'posted' : 'working')

  useEffect(() => {
    if (!isLoading && !isConnected) router.push('/onboarding')
  }, [isLoading, isConnected, router])

  useEffect(() => {
    if (role === 'client') setTab('posted')
    else setTab('working')
  }, [role])

  useEffect(() => {
    if (address) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  async function loadAll() {
    setLoading(true)
    try {
      const [jobsRes, appsRes] = await Promise.all([
        fetch(`/api/jobs?address=${encodeURIComponent(address!)}`).then((r) => r.json()),
        fetch(`/api/applications?address=${encodeURIComponent(address!)}`).then((r) => r.json()),
      ])
      setPosted(jobsRes.posted ?? [])
      setWorking(jobsRes.working ?? [])
      setApplications(appsRes.applications ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  if (isLoading || !isConnected) {
    return <div className="py-20 text-center"><Loader2 size={30} className="spin" style={{ color: 'var(--primary)', margin: '0 auto' }} /></div>
  }

  const earned = working.filter((j) => j.status === 'completed').reduce((s, j) => s + j.budgetZec, 0)
  const pending = working.filter((j) => ['in_progress', 'under_review', 'approved'].includes(j.status)).reduce((s, j) => s + j.budgetZec, 0)
  const escrow = posted.filter((j) => j.status !== 'completed' && j.status !== 'cancelled').reduce((s, j) => s + j.budgetZec, 0)

  const tabs = [
    ...(role === 'client' || posted.length > 0 ? [{ k: 'posted', l: `Posted (${posted.length})` }] : []),
    { k: 'working', l: `My Work (${working.length})` },
    { k: 'applications', l: `My Applications (${applications.length})` },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
          {profile?.displayName ? `Welcome, ${profile.displayName}` : 'Dashboard'}
        </h1>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 999 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
          <code style={{ fontSize: 12, color: 'var(--muted-2)' }}>{shortenAddress(address!, 8)}</code>
          {role && <span style={{ fontSize: 10, textTransform: 'uppercase', background: 'var(--primary)', color: 'var(--primary-ink)', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{role}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Jobs Posted', value: posted.length, color: 'var(--text)' },
          { label: 'Earned (ZEC)', value: earned.toFixed(3), color: 'var(--primary-dark)' },
          { label: 'Pending (ZEC)', value: pending.toFixed(3), color: 'var(--gold)' },
          { label: 'In Escrow (ZEC)', value: escrow.toFixed(3), color: 'var(--muted-2)' },
        ].map((c) => (
          <div key={c.label} className="card" style={{ padding: '18px 22px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.color, fontFamily: 'var(--font-geist-mono)' }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link href="/jobs/new" className="btn btn-primary"><Plus size={15} /> Post a Job</Link>
        <Link href="/jobs" className="btn btn-outline"><Briefcase size={15} /> Explore Jobs</Link>
        <a href="https://faucet.zecpages.com/" target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 13 }}>Claim testnet ZEC <ExternalLink size={12} /></a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as any)}
            style={{
              padding: '10px 18px', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer',
              fontWeight: tab === t.k ? 700 : 500,
              color: tab === t.k ? 'var(--primary-dark)' : 'var(--muted)',
              borderBottom: tab === t.k ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1,
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 12 }}>{[1, 2].map((i) => <div key={i} className="card shimmer" style={{ height: 150 }} />)}</div>
      ) : (
        <>
          {tab === 'posted' && (posted.length === 0 ? (
            <Empty icon={Briefcase} title="No jobs posted yet" desc="Post your first job and find talent." cta={{ href: '/jobs/new', label: 'Post a Job' }} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>{posted.map((j) => <JobCard key={j.id} job={j} currentAddress={address} />)}</div>
          ))}

          {tab === 'working' && (working.length === 0 ? (
            <Empty icon={Briefcase} title="No active work" desc="Browse open jobs and start earning ZEC." cta={{ href: '/jobs', label: 'Explore Jobs' }} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>{working.map((j) => <JobCard key={j.id} job={j} currentAddress={address} />)}</div>
          ))}

          {tab === 'applications' && (applications.length === 0 ? (
            <Empty icon={Send} title="No applications yet" desc="Apply to jobs to see them here." cta={{ href: '/jobs', label: 'Find Jobs' }} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {applications.map((a) => (
                <Link key={a.id} href={`/jobs/${a.jobId}`} className="card" style={{ padding: '18px 22px', textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Applied {timeAgo(a.createdAt)} · {formatZec(a.proposedPrice)}</div>
                    <div style={{ fontSize: 14, color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.coverLetter || 'View job →'}</div>
                  </div>
                  <span className="badge" style={
                    a.status === 'accepted' ? { color: 'var(--primary-dark)', borderColor: 'rgba(245,184,0,0.4)', background: 'var(--primary-glow)' }
                    : a.status === 'rejected' ? { color: '#dc2626', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }
                    : { color: 'var(--muted-2)', borderColor: 'var(--border-2)', background: 'var(--surface-2)' }
                  }>{a.status}</span>
                </Link>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Empty({ icon: Icon, title, desc, cta }: { icon: any; title: string; desc: string; cta: { href: string; label: string } }) {
  return (
    <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
      <Icon size={36} style={{ color: 'var(--muted)', margin: '0 auto 12px', opacity: 0.6 }} />
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 20 }}>{desc}</p>
      <Link href={cta.href} className="btn btn-primary">{cta.label}</Link>
    </div>
  )
}
