import Link from 'next/link'
import { Job } from '@/lib/types'
import { formatZec, timeAgo, statusColor, statusLabel, categoryIcon } from '@/lib/utils'
import { Clock, User, ChevronRight } from 'lucide-react'

interface Props {
  job: Job
  currentAddress?: string | null
}

export function JobCard({ job, currentAddress }: Props) {
  const isMyJob = currentAddress === job.clientAddress
  const isMyWork = currentAddress === job.workerAddress

  return (
    <Link
      href={`/jobs/${job.id}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div
        className="card"
        style={{
          padding: '20px 24px',
          transition: 'all 0.2s ease',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'var(--border-2)'
          el.style.transform = 'translateY(-2px)'
          el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'var(--border)'
          el.style.transform = 'translateY(0)'
          el.style.boxShadow = 'none'
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: 18 }}>{categoryIcon(job.category)}</span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  background: 'var(--surface-2)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                }}
              >
                {job.category}
              </span>
              {isMyJob && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--gold)',
                    background: 'rgba(245,158,11,0.1)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(245,158,11,0.3)',
                  }}
                >
                  Your Job
                </span>
              )}
              {isMyWork && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--primary)',
                    background: 'var(--primary-glow)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(16,185,129,0.3)',
                  }}
                >
                  Assigned
                </span>
              )}
            </div>
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {job.title}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.5,
              }}
            >
              {job.description}
            </p>
          </div>

          {/* Budget */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--gold)',
                fontFamily: 'var(--font-geist-mono)',
              }}
            >
              {formatZec(job.budgetZec)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>budget</div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between"
          style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-4">
            <span className={`badge ${statusColor(job.status)}`}>{statusLabel(job.status)}</span>

            <span
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Clock size={12} />
              {timeAgo(job.createdAt)}
            </span>

            {job.workerAddress && (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <User size={12} />
                {job.workerAddress.slice(0, 8)}…
              </span>
            )}
          </div>

          <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
            <ChevronRight size={16} />
          </span>
        </div>
      </div>
    </Link>
  )
}
