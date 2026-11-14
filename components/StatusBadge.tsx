import type { JobStatus } from '@/lib/types'

const states: Record<JobStatus, { label: string; tone: string; detail: string }> = {
  funding_required: { label: 'Funding needed', tone: 'pending', detail: 'The vault deposit has not been verified.' },
  open: { label: 'Open for work', tone: 'success', detail: 'The funded job is accepting a worker.' },
  in_progress: { label: 'In progress', tone: 'active', detail: 'The assigned worker is preparing the deliverable.' },
  under_review: { label: 'Under review', tone: 'pending', detail: 'Work acceptance is awaiting a verified result.' },
  needs_revision: { label: 'Revision requested', tone: 'pending', detail: 'Read the feedback before another review.' },
  approved: { label: 'Accepted', tone: 'success', detail: 'Work is accepted. The worker can request a claim.' },
  claiming: { label: 'Payout pending', tone: 'active', detail: 'A claim is reserved. Completion awaits wallet confirmation.' },
  rejected: { label: 'Review limit reached', tone: 'neutral', detail: 'The final review did not pass. A funded client refund can be requested.' },
  completed: { label: 'Payout confirmed', tone: 'success', detail: 'The wallet confirmed the matching payout.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', detail: 'This job is closed. Verified funding can be refunded.' },
  refunding: { label: 'Refund pending', tone: 'active', detail: 'A refund is reserved. Completion awaits wallet confirmation.' },
  refunded: { label: 'Refund confirmed', tone: 'success', detail: 'The wallet confirmed the client refund.' },
}

export function StatusBadge({ status, size = 'md' }: { status: JobStatus; size?: 'sm' | 'md' | 'lg' }) {
  const state = states[status]
  return <span className={`badge status-${state.tone} status-size-${size}`} title={state.detail}>
    <span aria-hidden="true" className="status-dot" />{state.label}
  </span>
}
