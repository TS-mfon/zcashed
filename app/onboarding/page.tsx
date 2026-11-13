'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { Role } from '@/lib/types'
import {
  Wallet, Copy, CheckCircle, Eye, EyeOff, ExternalLink, AlertCircle,
  Briefcase, PenTool, Loader2, ArrowRight, ArrowLeft,
} from 'lucide-react'

export default function OnboardingPage() {
  const router = useRouter()
  const { address, generateWallet, setAddress, saveProfile } = useWallet()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [role, setRole] = useState<Role>('freelancer')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [skills, setSkills] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [manualAddress, setManualAddress] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function copy(t: string) {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    const res = await generateWallet()
    if (res) setGeneratedKey(res.privateKeyHex)
    else setError('Failed to generate wallet. Try again.')
    setGenerating(false)
  }

  function handleManual() {
    if (!manualAddress.trim()) return
    setAddress(manualAddress.trim())
  }

  async function finish() {
    setSaving(true)
    const saved = await saveProfile({
      role,
      displayName: displayName.trim() || (role === 'client' ? 'Anonymous Client' : 'Anonymous Freelancer'),
      bio: bio.trim(),
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
    })
    setSaving(false)
    if (saved) router.push(role === 'client' ? '/jobs/new' : '/jobs')
  }

  const steps = ['Role', 'Wallet', 'Profile']

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      {/* Progress */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {steps.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: step > i ? 'var(--primary)' : 'var(--border-2)',
                transition: 'background .3s',
              }}
            />
            <div style={{ fontSize: 11, color: step > i ? 'var(--primary-dark)' : 'var(--muted)', marginTop: 6, fontWeight: 600 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Role */}
      {step === 1 && (
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Welcome to ZCashed</h1>
          <p style={{ color: 'var(--muted-2)', fontSize: 15, marginBottom: 28 }}>How do you want to use the platform?</p>

          <div style={{ display: 'grid', gap: 14 }}>
            {[
              { r: 'freelancer' as Role, icon: PenTool, title: 'I’m a Freelancer', desc: 'Find work, apply to jobs, and earn private ZEC payments.' },
              { r: 'client' as Role, icon: Briefcase, title: 'I’m a Client', desc: 'Post jobs, hire talent, and pay through AI-judged escrow.' },
            ].map((opt) => (
              <button
                key={opt.r}
                onClick={() => setRole(opt.r)}
                className="card"
                style={{
                  padding: 22,
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: role === opt.r ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: role === opt.r ? 'var(--primary-glow)' : 'var(--surface)',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                    background: role === opt.r ? 'var(--primary)' : 'var(--surface-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <opt.icon size={22} color={role === opt.r ? '#1a1500' : 'var(--muted-2)'} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{opt.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted-2)', marginTop: 2 }}>{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <button onClick={() => setStep(2)} className="btn btn-primary w-full" style={{ marginTop: 24, padding: 14 }}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Step 2: Wallet */}
      {step === 2 && (
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Your Zcash Wallet</h1>
          <p style={{ color: 'var(--muted-2)', fontSize: 15, marginBottom: 24 }}>Generate a testnet wallet, or connect an existing address.</p>

          {!address ? (
            <>
              <button onClick={handleGenerate} disabled={generating} className="btn btn-primary w-full" style={{ padding: 14 }}>
                {generating ? <Loader2 size={16} className="spin" /> : <Wallet size={16} />}
                {generating ? 'Generating…' : 'Generate Testnet Wallet'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  placeholder="Paste existing address (tm…)"
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  style={{ flex: 1, padding: '11px 14px', fontSize: 13, fontFamily: 'var(--font-geist-mono)' }}
                />
                <button onClick={handleManual} className="btn btn-outline" disabled={!manualAddress.trim()}>
                  Connect
                </button>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: 20, background: 'var(--primary-glow)', border: '1px solid rgba(245,184,0,0.4)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', fontWeight: 700, marginBottom: 6 }}>YOUR ADDRESS</div>
              <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, wordBreak: 'break-all', marginBottom: 8 }}>{address}</div>
              <button onClick={() => copy(address)} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }}>
                {copied ? <CheckCircle size={13} color="var(--primary-dark)" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
              </button>

              {generatedKey && (
                <div style={{ marginTop: 14, borderTop: '1px solid rgba(245,184,0,0.3)', paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)', fontWeight: 700 }}>PRIVATE KEY — SAVE IT!</span>
                    <button onClick={() => setShowKey(!showKey)} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }}>
                      {showKey ? <EyeOff size={12} /> : <Eye size={12} />} {showKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, wordBreak: 'break-all', color: showKey ? 'var(--primary-dark)' : 'var(--muted)' }}>
                    {showKey ? generatedKey : '•'.repeat(40)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10, fontSize: 11, color: 'var(--muted-2)' }}>
                    <AlertCircle size={13} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 1 }} />
                    Store this safely. It controls your funds and can’t be recovered.
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 8 }}>Claim free testnet ZEC:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href="https://faucet.zecpages.com/" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                    ZecPages <ExternalLink size={11} />
                  </a>
                  <a href="https://faucet.zcashfoundation.dev/" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                    ZF Faucet <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            </div>
          )}

          {error && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button onClick={() => setStep(1)} className="btn btn-ghost">
              <ArrowLeft size={15} /> Back
            </button>
            <button onClick={() => setStep(3)} disabled={!address} className="btn btn-primary" style={{ flex: 1, padding: 13 }}>
              Continue <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Profile */}
      {step === 3 && (
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Set up your profile</h1>
          <p style={{ color: 'var(--muted-2)', fontSize: 15, marginBottom: 24 }}>A few details so others know who they’re working with.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Display Name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Alex the Developer" style={{ width: '100%', padding: '12px 14px', fontSize: 14 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Bio</label>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell clients about your experience…" style={{ width: '100%', padding: '12px 14px', fontSize: 14, minHeight: 90, resize: 'vertical' }} />
            </div>
            {role === 'freelancer' && (
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Skills (comma separated)</label>
                <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, Solidity, Design…" style={{ width: '100%', padding: '12px 14px', fontSize: 14 }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button onClick={() => setStep(2)} className="btn btn-ghost">
              <ArrowLeft size={15} /> Back
            </button>
            <button onClick={finish} disabled={saving} className="btn btn-primary" style={{ flex: 1, padding: 13 }}>
              {saving ? <Loader2 size={16} className="spin" /> : null}
              {saving ? 'Saving…' : 'Finish & Enter ZCashed'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
