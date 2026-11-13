'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Job, Application } from '@/lib/types'
import { formatZec, timeAgo, categoryIcon, shortenAddress } from '@/lib/utils'
import {
  Clock, User, Copy, CheckCircle, XCircle, Loader2, Brain, AlertCircle,
  RefreshCw, ArrowLeft, ExternalLink, Send, Users, Award,
} from 'lucide-react'
import Link from 'next/link'

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { address, isConnected } = useWallet()

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [subState, setSubState] = useState<'idle' | 'evaluating' | 'approved' | 'rejected'>('idle')
  const [aiFeedback, setAiFeedback] = useState('')
  const [txHash, setTxHash] = useState('')

  const [submissionUrl, setSubmissionUrl] = useState('')
  const [submissionNotes, setSubmissionNotes] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [proposedPrice, setProposedPrice] = useState('')

  useEffect(() => { loadJob() }, [id])

  async function loadJob() {
    try {
      const res = await fetch(`/api/jobs/${id}`)
      const data = await res.json()
      setJob(data.job)
    } catch {
      setError('Failed to load job')
    } finally {
      setLoading(false)
    }
  }

  function copy(t: string) {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleAccept() {
    if (!address) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/jobs/${id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerAddress: address }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await loadJob()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault()
    if (!address) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/jobs/${id}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicantAddress: address, coverLetter, proposedPrice }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCoverLetter(''); setProposedPrice('')
      await loadJob()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function handleAssign(applicationId: string) {
    if (!address) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/jobs/${id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, clientAddress: address }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await loadJob()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  async function handleSubmitWork(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !job) return
    if (!submissionUrl.trim()) { setError('Provide your submission URL or proof'); return }
    setError(''); setSubmitting(true); setSubState('evaluating')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, workerAddress: address, submissionUrl: submissionUrl.trim(), notes: submissionNotes.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTxHash(data.txHash ?? '')
      if (data.approved) setSubState('approved')
      else { setSubState('rejected'); setAiFeedback(data.rejectionReason ?? 'Work did not meet requirements.') }
      await loadJob()
    } catch (e: any) { setError(e.message); setSubState('idle') } finally { setSubmitting(false) }
  }

  function resetSubmit() {
    setSubState('idle'); setAiFeedback(''); setSubmissionUrl(''); setSubmissionNotes(''); setError('')
  }

  if (loading) return <div className="py-20 text-center"><Loader2 size={30} className="spin" style={{ color: 'var(--primary)', margin: '0 auto' }} /></div>
  if (!job) return <div className="py-20 text-center"><p style={{ color: 'var(--muted-2)' }}>Job not found.</p><Link href="/jobs" className="btn btn-primary mt-4">Back to Jobs</Link></div>

  const isClient = address === job.clientAddress
  const isWorker = address === job.workerAddress
  const myApp = (job.applications ?? []).find((a) => a.applicantAddress === address)
  const canAcceptDirect = isConnected && job.assignmentMode === 'direct' && job.status === 'open' && !isClient && !job.workerAddress
  const canApply = isConnected && job.assignmentMode === 'application' && job.status === 'open' && !isClient && !myApp
  const canSubmit = isWorker && (job.status === 'in_progress' || job.status === 'needs_revision') && subState === 'idle'
  const latestSub = (job.submissions ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted-2)', fontSize: 13, textDecoration: 'none', marginBottom: 24 }}>
        <ArrowLeft size={15} /> Back to Jobs
      </Link>

      {/* Header */}
      <div className="card" style={{ padding: '28px 32px', marginBottom: 20 }}>
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20 }}>{categoryIcon(job.category)}</span>
              <span style={{ fontSize: 12, color: 'var(--muted-2)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>{job.category}</span>
              <span style={{ fontSize: 11, color: 'var(--primary-dark)', background: 'var(--primary-glow)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(245,184,0,0.3)', fontWeight: 600 }}>
                {job.assignmentMode === 'direct' ? 'Direct assign' : 'By application'}
              </span>
              <StatusBadge status={job.status} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{job.title}</h1>
            <div className="flex flex-wrap gap-4" style={{ fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {timeAgo(job.createdAt)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={12} /> {shortenAddress(job.clientAddress, 8)}</span>
              {job.assignmentMode === 'application' && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {(job.applications ?? []).length} applicant{(job.applications ?? []).length !== 1 ? 's' : ''}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary-dark)', fontFamily: 'var(--font-geist-mono)' }}>{formatZec(job.budgetZec)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>escrow budget</div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, fontSize: 14, color: 'var(--muted-2)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{job.description}</div>
      </div>

      {/* Escrow (client) */}
      {isClient && (
        <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Escrow Address — fund this</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all', background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>{job.escrowAddress}</code>
            <button onClick={() => copy(job.escrowAddress)} className="btn btn-ghost">{copied ? <CheckCircle size={16} color="var(--primary-dark)" /> : <Copy size={16} />}</button>
          </div>
        </div>
      )}

      {/* Assigned banner */}
      {job.workerAddress && (
        <div style={{ background: 'var(--primary-glow)', border: '1px solid rgba(245,184,0,0.3)', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Award size={16} style={{ color: 'var(--primary-dark)' }} />
          <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>Assigned to <code style={{ fontSize: 12, color: 'var(--text)' }}>{shortenAddress(job.workerAddress, 8)}</code></span>
        </div>
      )}

      {/* GenLayer contract */}
      {job.genlayerContractAddress && (
        <div className="card" style={{ padding: '14px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>GENLAYER CONTRACT</div>
            <code style={{ fontSize: 12, color: 'var(--muted-2)' }}>{shortenAddress(job.genlayerContractAddress, 12)}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--primary-dark)', fontWeight: 600 }}><Brain size={14} /> AI Active</div>
        </div>
      )}

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}><AlertCircle size={15} />{error}</div>}

      {/* Direct accept */}
      {canAcceptDirect && (
        <div className="card gradient-border" style={{ padding: '28px 32px', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Accept this job</h3>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 20 }}>This is a direct-assignment job. Accept to start immediately — it becomes exclusively yours.</p>
          <button onClick={handleAccept} disabled={busy} className="btn btn-primary w-full" style={{ padding: 14, fontSize: 15 }}>
            {busy ? <Loader2 size={16} className="spin" /> : null} {busy ? 'Accepting…' : `Accept — Earn ${formatZec(job.budgetZec)}`}
          </button>
        </div>
      )}

      {/* Apply form */}
      {canApply && (
        <div className="card" style={{ padding: '28px 32px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Send size={18} color="var(--primary-dark)" /><h3 style={{ fontSize: 18, fontWeight: 700 }}>Apply for this job</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 20 }}>Pitch yourself. The client reviews all applicants and picks who to hire.</p>
          <form onSubmit={handleApply} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Cover letter</label>
              <textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} placeholder="Why are you the right fit? Share relevant experience…" style={{ width: '100%', padding: '12px 14px', fontSize: 14, minHeight: 110, resize: 'vertical' }} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Your price (ZEC) — optional</label>
              <input type="number" step="0.0001" value={proposedPrice} onChange={(e) => setProposedPrice(e.target.value)} placeholder={`Default: ${job.budgetZec}`} style={{ width: '100%', padding: '12px 14px', fontSize: 14 }} />
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary" style={{ padding: 14, fontSize: 15 }}>
              {busy ? <Loader2 size={16} className="spin" /> : null} {busy ? 'Submitting…' : 'Submit Application'}
            </button>
          </form>
        </div>
      )}

      {/* Already applied */}
      {myApp && job.status === 'open' && (
        <div className="card" style={{ padding: '20px 24px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <CheckCircle size={18} color="var(--primary-dark)" />
          <span style={{ fontSize: 14, color: 'var(--muted-2)' }}>Your application is submitted. The client will review and decide.</span>
        </div>
      )}

      {/* Client: review applicants */}
      {isClient && job.assignmentMode === 'application' && job.status === 'open' && (
        <div className="card" style={{ padding: '24px 28px', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}><Users size={18} /> Applicants ({(job.applications ?? []).length})</h3>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 18 }}>Review and pick who to hire. The rest are automatically notified.</p>
          {(job.applications ?? []).length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No applications yet. Share your job!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(job.applications ?? []).map((a: Application) => (
                <div key={a.id} style={{ border: '1px solid var(--border-2)', borderRadius: 12, padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{a.applicantName || 'Anonymous Freelancer'}</div>
                      <code style={{ fontSize: 11, color: 'var(--muted)' }}>{shortenAddress(a.applicantAddress, 8)}</code>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--primary-dark)', fontFamily: 'var(--font-geist-mono)' }}>{formatZec(a.proposedPrice)}</div>
                  </div>
                  {a.coverLetter && <p style={{ fontSize: 13.5, color: 'var(--muted-2)', lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{a.coverLetter}</p>}
                  <button onClick={() => handleAssign(a.id)} disabled={busy} className="btn btn-primary" style={{ fontSize: 13 }}>
                    {busy ? <Loader2 size={14} className="spin" /> : <Award size={14} />} Hire this freelancer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submit work */}
      {canSubmit && (
        <div className="card" style={{ padding: '28px 32px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Brain size={20} color="var(--primary-dark)" /><h3 style={{ fontSize: 18, fontWeight: 700 }}>Submit your work</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 20 }}>Your submission is evaluated immediately by GenLayer AI validators.</p>
          {job.status === 'needs_revision' && latestSub?.aiFeedback && (
            <div style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>AI FEEDBACK — LAST SUBMISSION</div>
              <p style={{ fontSize: 13, color: 'var(--muted-2)', lineHeight: 1.6 }}>{latestSub.aiFeedback}</p>
            </div>
          )}
          <form onSubmit={handleSubmitWork} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Submission URL / proof <span style={{ color: 'var(--gold)' }}>*</span></label>
              <input value={submissionUrl} onChange={(e) => setSubmissionUrl(e.target.value)} placeholder="https://github.com/… or a link to your deliverable" style={{ width: '100%', padding: '12px 14px', fontSize: 14 }} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Notes (optional)</label>
              <textarea value={submissionNotes} onChange={(e) => setSubmissionNotes(e.target.value)} placeholder="Explain what you delivered…" style={{ width: '100%', padding: '12px 14px', fontSize: 14, minHeight: 90, resize: 'vertical' }} />
            </div>
            <button type="submit" disabled={submitting} className="btn btn-primary" style={{ padding: 14, fontSize: 15 }}>Submit for AI Review →</button>
          </form>
        </div>
      )}

      {/* Evaluating */}
      {subState === 'evaluating' && (
        <div className="card gradient-border" style={{ padding: '48px 32px', textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--primary-glow)', border: '2px solid rgba(245,184,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', animation: 'pulse-glow 2s ease-in-out infinite' }}>
            <Brain size={32} color="var(--primary-dark)" />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>AI validators evaluating…</h3>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>GenLayer validators are reaching consensus on your submission. This usually takes 15–60s.</p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 24 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', animation: `pulse-glow 1.4s ease-in-out ${i * 0.2}s infinite` }} />)}
          </div>
        </div>
      )}

      {/* Approved */}
      {subState === 'approved' && (
        <div className="card" style={{ padding: '48px 32px', textAlign: 'center', marginBottom: 20, border: '1px solid rgba(245,184,0,0.5)', background: 'var(--primary-glow)' }}>
          <CheckCircle size={48} color="var(--primary-dark)" style={{ margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, color: 'var(--primary-dark)' }}>Work Approved! 🎉</h3>
          <p style={{ fontSize: 14, color: 'var(--muted-2)', marginBottom: 20, lineHeight: 1.6 }}>The AI judges approved your submission. <strong>{formatZec(job.budgetZec)}</strong> released to your Zcash address.</p>
          {txHash && <code style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', padding: '8px 16px', borderRadius: 6, marginBottom: 20, display: 'inline-block' }}>TX: {txHash.slice(0, 22)}…</code>}
          <div><button onClick={() => router.push('/dashboard')} className="btn btn-primary">View Dashboard</button></div>
        </div>
      )}

      {/* Rejected */}
      {subState === 'rejected' && (
        <div className="card" style={{ padding: 32, marginBottom: 20, border: '1px solid rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.06)' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <XCircle size={24} color="var(--gold)" style={{ flexShrink: 0 }} />
            <div><h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Needs revision</h3><p style={{ fontSize: 13, color: 'var(--muted-2)' }}>The AI judges found issues to fix.</p></div>
          </div>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>AI FEEDBACK</div>
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{aiFeedback}</p>
          </div>
          <button onClick={resetSubmit} className="btn btn-outline" style={{ gap: 8 }}><RefreshCw size={15} /> Fix & Resubmit</button>
        </div>
      )}

      {/* Submission history */}
      {(job.submissions ?? []).length > 0 && subState === 'idle' && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--muted-2)' }}>Submission history ({job.submissions.length})</h4>
          {job.submissions.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((sub, i) => (
            <div key={sub.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none', paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0 }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Attempt #{sub.attempt}</span>
                <span className="badge" style={sub.status === 'approved' ? { color: 'var(--primary-dark)', borderColor: 'rgba(245,184,0,0.4)', background: 'var(--primary-glow)' } : { color: '#dc2626', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}>{sub.status}</span>
              </div>
              <a href={sub.submissionUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--primary-dark)', textDecoration: 'none' }}>
                {sub.submissionUrl.slice(0, 60)}{sub.submissionUrl.length > 60 ? '…' : ''} <ExternalLink size={11} />
              </a>
              {sub.aiFeedback && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{sub.aiFeedback}</p>}
            </div>
          ))}
        </div>
      )}

      {job.status === 'completed' && (
        <div className="card" style={{ padding: '24px 28px', textAlign: 'center', border: '1px solid rgba(245,184,0,0.4)', background: 'var(--primary-glow)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Job completed</h3>
          <p style={{ fontSize: 13, color: 'var(--muted-2)' }}>Work was approved and payment released successfully.</p>
        </div>
      )}
    </div>
  )
}
