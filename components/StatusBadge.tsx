import { JobStatus } from '@/lib/types'
import { statusColor, statusLabel } from '@/lib/utils'

export function StatusBadge({ status, size = 'md' }: { status: JobStatus; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'sm' ? 'text-xs py-0.5 px-2' : size === 'lg' ? 'text-sm py-1.5 px-4' : 'text-xs py-1 px-3'
  return (
    <span className={`badge ${statusColor(status)} ${sizeClass}`}>
      {statusLabel(status)}
    </span>
  )
}
