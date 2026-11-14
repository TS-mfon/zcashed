'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { JobCard } from '@/components/JobCard'
import { Job, Profile } from '@/lib/types'
import { formatZec, shortenAddress } from '@/lib/utils'
import { Loader2, Shield, Database } from 'lucide-react'

interface AdminData {
  jobs: Job[]
  profiles: Profile[]
  stats: {
    totalJobs: number
    openJobs: number
    inProgressJobs: number
    completedJobs: number
    totalUsers: number
    freelancers: number
    backend: string
  }
}

export default function AdminPage() {
  const { address, role, isLoading } = useWallet()
  const router = useRouter()
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'overview' | 'jobs' | 'users'>('overview')

  useEffect(() => {
    if (isLoading || role !== 'admin') return
    fetch('/api/admin')
      .then((r) => {
        if (!r.ok) throw new Error('Administrator data is unavailable or this session is not authorized.')
        return r.json()
      })
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => { setError('Administrator data is unavailable or this session is not authorized.'); setLoading(false) })
  }, [isLoading, role])

  if (isLoading) return <div className="py-20 text-center"><Loader2 className="spin" style={{ margin: '0 auto', color: 'var(--primary)' }} /></div>

  // The server must authorize administrator access independently of this UI.
  if (role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <Shield size={40} style={{ color: 'var(--gold)', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Admin access only</h2>
        <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 20 }}>
          This page requires a server-authorized administrator session.
        </p>
        <button onClick={() => router.push('/')} className="btn btn-primary">Back Home</button>
      </div>
    )
  }

  const s = data?.stats

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Shield size={24} color="var(--primary-dark)" />
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>Admin Panel</h1>
      </div>
      <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Database size={14} /> Backend: <strong>{s?.backend ?? '…'}</strong>
      </p>

      {error ? <div role="alert" className="card" style={{ padding: 20 }}>{error}</div> : loading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="card shimmer" style={{ height: 90 }} />)}</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" style={{ marginBottom: 28 }}>
            {[
              { label: 'Total Jobs', value: data.stats.totalJobs },
              { label: 'Open', value: data.stats.openJobs },
              { label: 'In Progress', value: data.stats.inProgressJobs },
              { label: 'Accepted / recorded', value: data.stats.completedJobs },
              { label: 'Users', value: data.stats.totalUsers },
              { label: 'Freelancers', value: data.stats.freelancers },
              { label: 'Accepted budgets', value: formatZec(data.jobs.filter((job) => ['approved', 'completed'].includes(job.status)).reduce((sum, job) => sum + job.budgetZatoshis, 0) / 100000000) },
              { label: 'Posted offers', value: formatZec(data.jobs.filter((job) => job.status !== 'cancelled').reduce((sum, job) => sum + job.budgetZatoshis, 0) / 100000000) },
            ].map((c) => (
              <div key={c.label} className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary-dark)', fontFamily: 'var(--font-geist-mono)' }}>{c.value}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--muted-2)', fontSize: 13, marginBottom: 20 }}>These are public job budgets. They do not prove that funds were sent or received.</p>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
            {[{ k: 'jobs' as const, l: `All Jobs (${data!.jobs.length})` }, { k: 'users' as const, l: `Users (${data!.profiles.length})` }].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
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

          {tab === 'users' ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              {data!.profiles.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-2)' }}>No users yet</div>
              ) : (
                data!.profiles.map((p, i) => (
                  <div key={p.address} style={{ padding: '14px 20px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.displayName || 'Anonymous'}</div>
                      <code style={{ fontSize: 12, color: 'var(--muted)' }}>{shortenAddress(p.address, 10)}</code>
                    </div>
                    <span className="badge" style={{ textTransform: 'capitalize', borderColor: 'var(--border-2)', color: 'var(--primary-dark)', background: 'var(--primary-glow)' }}>{p.role}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {data!.jobs.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted-2)' }}>No jobs yet</div>
              ) : (
                data!.jobs.map((j) => <JobCard key={j.id} job={j} currentAddress={address} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
