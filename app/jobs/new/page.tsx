'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import type { Job } from '@/lib/types'
import { parseZecToZatoshis } from '@/lib/zcash'
import { SUPPORTED_JOB_CATEGORIES, TEXT_DELIVERABLE_KINDS, TEXT_DELIVERABLE_LABELS, TEXT_JOB_SCOPE, validateTextJob, type TextDeliverableKind } from '@/lib/job-policy'
import { Info, AlertCircle, Loader2 } from 'lucide-react'

export default function NewJobPage() {
  const router = useRouter()
  const { address, username, isConnected, role, isLoading } = useWallet()

  const creationId = useRef<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Writing',
    deliverableKind: 'article' as TextDeliverableKind,
    budgetZec: '',
    deadline: '',
    assignmentMode: 'application' as 'direct' | 'application',
  })
  const [step, setStep] = useState<'form' | 'done'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdJob, setCreatedJob] = useState<Job | null>(null)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address) {
      setError('Connect your existing wallet first.')
      return
    }
    if (!form.title.trim() || !form.description.trim() || !form.budgetZec) {
      setError('Please fill in all required fields')
      return
    }
    const policyError = validateTextJob(form)
    if (policyError) { setError(policyError); return }
    let budgetZatoshis: number
    try { budgetZatoshis = parseZecToZatoshis(form.budgetZec) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid ZEC budget.'); return }

    if (!creationId.current) creationId.current = crypto.randomUUID()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creationId: creationId.current,
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          deliverableKind: form.deliverableKind,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
          assignmentMode: form.assignmentMode,
          budgetZatoshis,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create job')
      if (!data.job?.id) throw new Error('The server did not return the created job.')
      setCreatedJob(data.job)
      setStep('done')
      router.push(`/jobs/${data.job.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the job.')
    } finally {
      setLoading(false)
    }
  }

  if (isLoading) return <div role="status" className="py-20 text-center"><Loader2 size={28} className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary-dark)' }} />Restoring your wallet session…</div>

  if (!isConnected || !username || role !== 'client') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="card" style={{ padding: 40 }}>
          <AlertCircle size={40} style={{ color: 'var(--gold)', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Connect a client profile</h2>
          <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 24 }}>
            Connect your existing wallet and choose the client role to post a job.
          </p>
          <button onClick={() => router.push('/onboarding')} className="btn btn-primary w-full">
            Connect existing wallet
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done' && createdJob) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="card gradient-border" style={{ padding: 48 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Job created · funding required</h2>
          <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 32 }}>
            Continue to your job to fund its testnet vault from your existing wallet. The job opens after the vault wallet confirms the deposit.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => router.push(`/jobs/${createdJob.id}`)} className="btn btn-primary">
              Continue to funding
            </button>
            <button onClick={() => router.push('/jobs')} className="btn btn-outline">
              Browse All Jobs
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Post a Job</h1>
        <p style={{ color: 'var(--muted-2)', fontSize: 14 }}>
          Post a text deliverable with requirements GenLayer can assess from the submitted words.
        </p>
        <div className="card" style={{ padding: 16, marginTop: 20, background: 'var(--primary-glow)', fontSize: 13, lineHeight: 1.7 }}>
          <strong>Text jobs only.</strong> {TEXT_JOB_SCOPE} Website builds, code, designs, images, files, external research, and links are disabled. Fund the testnet vault after creation. Each job allows three judged submissions; provider failures do not use an attempt.
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Title */}
        <div>
          <label htmlFor="job-title" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Job Title <span style={{ color: 'var(--gold)' }}>*</span>
          </label>
          <input
            id="job-title"
            type="text"
            placeholder="e.g. Write a friendly product announcement"
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
            required
          />
        </div>

        {/* Category + Budget row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="job-category" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
              Category <span style={{ color: 'var(--gold)' }}>*</span>
            </label>
            <select
            id="job-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
            >
              {SUPPORTED_JOB_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="job-budget" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
              Budget (ZEC) <span style={{ color: 'var(--gold)' }}>*</span>
            </label>
            <input
            id="job-budget"
              type="number"
              step="0.00000001"
              min="0.00000001"
              placeholder="0.5"
              value={form.budgetZec}
              onChange={(e) => setForm({ ...form, budgetZec: e.target.value })}
              style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="job-deliverable" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>Text deliverable <span style={{ color: 'var(--gold)' }}>*</span></label>
          <select id="job-deliverable" value={form.deliverableKind} onChange={(event) => setForm({ ...form, deliverableKind: event.target.value as TextDeliverableKind })} style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}>
            {TEXT_DELIVERABLE_KINDS.map(kind => <option key={kind} value={kind}>{TEXT_DELIVERABLE_LABELS[kind]}</option>)}
          </select>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="job-description" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Task Description <span style={{ color: 'var(--gold)' }}>*</span>
          </label>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            Use one criterion per line, up to 12. Specify tone, structure, length, and required wording. For translation, edits, or summaries, paste the source text into the relevant criterion. Avoid requirements that need external verification.
          </p>
          <textarea
            id="job-description"
            placeholder={'Write a 150–200 word announcement for a reusable water bottle.\nUse a friendly tone and three short paragraphs.\nInclude the phrase "Refill, reuse, repeat" and a call to action.'}
            minLength={20}
            maxLength={12000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ width: '100%', padding: '12px 16px', fontSize: 14, minHeight: 160, resize: 'vertical' }}
            required
          />
        </div>

        {/* Deadline */}
        <div>
          <label htmlFor="job-deadline" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Delivery deadline (defaults to 7 days)
          </label>
          <input
            id="job-deadline"
            type="datetime-local"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            style={{ padding: '12px 16px', fontSize: 14 }}
          />
          <p style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 8 }}>Choose one hour to 90 days from now. All revisions are due before this deadline. If unfinished, the client can close the job and request a refund.</p>
        </div>

        {/* Assignment mode */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--muted-2)' }}>
            How do you want to assign this job? <span style={{ color: 'var(--gold)' }}>*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { v: 'application', title: 'Application-based', desc: 'Freelancers apply; you pick who to hire.' },
              { v: 'direct', title: 'Direct assignment', desc: 'First qualified freelancer accepts instantly.' },
            ].map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => setForm({ ...form, assignmentMode: m.v as 'direct' | 'application' })}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: form.assignmentMode === m.v ? 'var(--primary-glow)' : 'var(--surface)',
                  border: form.assignmentMode === m.v ? '2px solid var(--primary)' : '1px solid var(--border-2)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* AI notice */}
        <div
          style={{
            background: 'var(--primary-glow)',
            border: '1px solid rgba(245,184,0,0.3)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <Info size={15} style={{ color: 'var(--primary-dark)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--primary-dark)' }}>AI-Powered Judgment:</strong> GenLayer’s
            Intelligent Contract first checks that your rubric can be evaluated entirely from pasted text, then evaluates the delivered text against that frozen rubric. The native Zcash vault handles funding and the approved freelancer’s claim.
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
              padding: '12px 16px',
              color: '#f87171',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary"
          style={{ padding: '14px', fontSize: 15 }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="spin" style={{ width: 18, height: 18, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
              Creating Job…
            </span>
          ) : (
            'Create job & continue to funding'
          )}
        </button>
      </form>
    </div>
  )
}
