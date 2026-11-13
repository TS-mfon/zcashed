'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { JOB_CATEGORIES } from '@/lib/types'
import { Copy, CheckCircle, Info, AlertCircle } from 'lucide-react'

export default function NewJobPage() {
  const router = useRouter()
  const { address, isConnected } = useWallet()

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Development',
    budgetZec: '',
    deadline: '',
    assignmentMode: 'application' as 'direct' | 'application',
  })
  const [step, setStep] = useState<'form' | 'deposit' | 'done'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdJob, setCreatedJob] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address) {
      setError('Please connect your wallet first')
      return
    }
    if (!form.title.trim() || !form.description.trim() || !form.budgetZec) {
      setError('Please fill in all required fields')
      return
    }
    const budget = parseFloat(form.budgetZec)
    if (isNaN(budget) || budget <= 0) {
      setError('Please enter a valid ZEC budget')
      return
    }

    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          budgetZec: budget,
          clientAddress: address,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create job')
      setCreatedJob(data.job)
      setStep('deposit')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeposited() {
    setLoading(true)
    try {
      await fetch(`/api/jobs/${createdJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      })
      setStep('done')
    } catch {
      setStep('done')
    } finally {
      setLoading(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="card" style={{ padding: 40 }}>
          <AlertCircle size={40} style={{ color: 'var(--gold)', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Wallet Required</h2>
          <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 24 }}>
            You need a Zcash address to post a job and receive funds.
          </p>
          <button onClick={() => router.push('/dashboard')} className="btn btn-primary w-full">
            Set Up Wallet
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="card gradient-border" style={{ padding: 48 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Job is Live!</h2>
          <p style={{ color: 'var(--muted-2)', fontSize: 14, marginBottom: 32 }}>
            Your job is now visible to workers. You'll be notified when someone accepts it.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => router.push(`/jobs/${createdJob.id}`)} className="btn btn-primary">
              View Job
            </button>
            <button onClick={() => router.push('/jobs')} className="btn btn-outline">
              Browse All Jobs
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'deposit') {
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Fund Your Escrow</h1>
          <p style={{ color: 'var(--muted-2)', fontSize: 14 }}>
            Send exactly{' '}
            <strong style={{ color: 'var(--gold)' }}>{form.budgetZec} ZEC</strong> to the escrow
            address below to activate your job.
          </p>
        </div>

        {/* Escrow address */}
        <div className="card" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>
              JOB ESCROW ADDRESS
            </div>
            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border-2)',
                borderRadius: 8,
                padding: '12px 16px',
                fontFamily: 'var(--font-geist-mono)',
                fontSize: 13,
                color: 'var(--text)',
                wordBreak: 'break-all',
              }}
            >
              {createdJob?.escrowAddress}
            </div>
          </div>
          <button
            onClick={() => copy(createdJob?.escrowAddress)}
            className="btn btn-outline w-full"
            style={{ gap: 8, fontSize: 13 }}
          >
            {copied ? <CheckCircle size={15} color="var(--primary)" /> : <Copy size={15} />}
            {copied ? 'Copied!' : 'Copy Address'}
          </button>
        </div>

        {/* Amount */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted-2)', fontSize: 14 }}>Amount to send</span>
            <span
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-geist-mono)' }}
            >
              {form.budgetZec} ZEC
            </span>
          </div>
        </div>

        {/* Faucet info */}
        <div
          style={{
            background: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 10,
            padding: '16px 20px',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Info size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', marginBottom: 6 }}>
                Need testnet ZEC?
              </p>
              <p style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.6 }}>
                Get free testnet ZEC from the faucet, then paste the escrow address above.
              </p>
              <div className="flex gap-3 mt-10px flex-wrap" style={{ marginTop: 10 }}>
                <a
                  href="https://faucet.zecpages.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  ZecPages Faucet ↗
                </a>
                <a
                  href="https://faucet.zcashfoundation.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  ZF Faucet ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleDeposited}
          disabled={loading}
          className="btn btn-primary w-full"
          style={{ padding: '14px', fontSize: 15 }}
        >
          {loading ? (
            <span className="spin" style={{ width: 18, height: 18, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
          ) : (
            "I've Sent the ZEC — Activate Job"
          )}
        </button>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
          In production, the platform verifies the deposit automatically on-chain.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Post a Job</h1>
        <p style={{ color: 'var(--muted-2)', fontSize: 14 }}>
          Describe your task clearly. The AI will use your description to judge submitted work.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Title */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Job Title <span style={{ color: 'var(--gold)' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Build a React landing page, Write a blog post about DeFi…"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
            required
          />
        </div>

        {/* Category + Budget row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
              Category <span style={{ color: 'var(--gold)' }}>*</span>
            </label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
            >
              {JOB_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
              Budget (ZEC) <span style={{ color: 'var(--gold)' }}>*</span>
            </label>
            <input
              type="number"
              step="0.0001"
              min="0.001"
              placeholder="0.5"
              value={form.budgetZec}
              onChange={(e) => setForm({ ...form, budgetZec: e.target.value })}
              style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
              required
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Task Description <span style={{ color: 'var(--gold)' }}>*</span>
          </label>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            Be specific — the AI judge will use this to evaluate submissions.
          </p>
          <textarea
            placeholder="Describe exactly what you need. Include deliverables, format, any specific requirements…"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ width: '100%', padding: '12px 16px', fontSize: 14, minHeight: 160, resize: 'vertical' }}
            required
          />
        </div>

        {/* Deadline */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--muted-2)' }}>
            Deadline (optional)
          </label>
          <input
            type="date"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            style={{ padding: '12px 16px', fontSize: 14 }}
          />
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
            <strong style={{ color: 'var(--primary-dark)' }}>AI-Powered Judgment:</strong> GenLayer's
            Intelligent Contract will evaluate submissions against your description. Write clear,
            specific requirements to get the best results.
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
            'Continue to Funding →'
          )}
        </button>
      </form>
    </div>
  )
}
