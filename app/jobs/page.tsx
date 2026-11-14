'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { JobCard } from '@/components/JobCard'
import { useWallet } from '@/components/WalletContext'
import { Job, JOB_CATEGORIES } from '@/lib/types'
import { Plus, Search, SlidersHorizontal, Briefcase } from 'lucide-react'

export default function JobsPage() {
  const { address } = useWallet()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    fetch('/api/jobs')
      .then((r) => r.json())
      .then((data) => {
        setJobs(data.jobs ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = jobs.filter((job) => {
    const matchSearch =
      !search ||
      job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.description.toLowerCase().includes(search.toLowerCase())
    const matchCat = category === 'All' || job.category === category
    const matchStatus = statusFilter === 'all' || job.status === statusFilter
    return matchSearch && matchCat && matchStatus
  })

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Browse Jobs</h1>
          <p style={{ color: 'var(--muted-2)', fontSize: 14 }}>
            {loading ? 'Loading…' : `${filtered.length} job${filtered.length !== 1 ? 's' : ''} available`}
          </p>
        </div>
        <Link href="/jobs/new" className="btn btn-primary" style={{ flexShrink: 0 }}>
          <Plus size={16} />
          Post a Job
        </Link>
      </div>

      {/* Filters */}
      <div
        className="card mb-6"
        style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
      >
        {/* Search */}
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search
            size={16}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
          />
          <input
            type="text"
            placeholder="Search jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 12px 8px 36px', fontSize: 14 }}
          />
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SlidersHorizontal size={15} style={{ color: 'var(--muted)' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['All', ...JOB_CATEGORIES] as string[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  transition: 'all 0.15s',
                  background: category === cat ? 'var(--primary)' : 'transparent',
                  color: category === cat ? '#fff' : 'var(--muted-2)',
                  borderColor: category === cat ? 'var(--primary)' : 'var(--border)',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, minWidth: 140 }}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="under_review">Under Review</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card shimmer" style={{ height: 180 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="card"
          style={{ padding: '80px 40px', textAlign: 'center' }}
        >
          <Briefcase size={40} style={{ color: 'var(--muted)', margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No jobs found</h3>
          <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 24 }}>
            {search || category !== 'All' ? 'Try adjusting your filters' : 'Be the first to post a job'}
          </p>
          <Link href="/jobs/new" className="btn btn-primary">
            <Plus size={15} />
            Post the First Job
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} currentAddress={address} />
          ))}
        </div>
      )}
    </div>
  )
}
