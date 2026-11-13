import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { JobStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatZec(amount: number): string {
  return `${amount.toFixed(4)} ZEC`
}

export function shortenAddress(addr: string, chars = 6): string {
  if (!addr) return ''
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export function statusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    under_review: 'Under Review',
    needs_revision: 'Needs Revision',
    approved: 'Approved',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return labels[status] ?? status
}

export function statusColor(status: JobStatus): string {
  const colors: Record<JobStatus, string> = {
    open: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    in_progress: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    under_review: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    needs_revision: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    completed: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  return colors[status] ?? 'bg-gray-500/15 text-gray-400'
}

export function categoryIcon(category: string): string {
  const icons: Record<string, string> = {
    Development: '⚡',
    Design: '🎨',
    Writing: '✍️',
    Marketing: '📣',
    Research: '🔬',
    Data: '📊',
    Security: '🔒',
    Other: '💼',
  }
  return icons[category] ?? '💼'
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
