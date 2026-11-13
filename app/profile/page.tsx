'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { Copy, CheckCircle, Loader2, ExternalLink, LogOut } from 'lucide-react'

export default function ProfilePage() {
  const { address, profile, isConnected, isLoading, saveProfile, clearWallet, role } = useWallet()
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [skills, setSkills] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName)
      setBio(profile.bio)
      setSkills((profile.skills ?? []).join(', '))
    }
  }, [profile])

  if (isLoading) return <div className="py-20 text-center"><Loader2 className="spin" style={{ margin: '0 auto', color: 'var(--primary)' }} /></div>

  if (!isConnected) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Connect your wallet</h2>
        <button onClick={() => router.push('/onboarding')} className="btn btn-primary">Connect Wallet</button>
      </div>
    )
  }

  async function save() {
    setSaving(true)
    await saveProfile({
      displayName,
      bio,
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function copy(t: string) {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>Your Profile</h1>

      {/* Wallet card */}
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary), #ffd94d)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 800, color: '#1a1500',
            }}
          >
            {(displayName || 'Z')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{displayName || 'Anonymous'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)', textTransform: 'capitalize' }}>{role ?? 'freelancer'}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>ZCASH ADDRESS</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <code style={{ flex: 1, fontSize: 12, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 8, wordBreak: 'break-all', border: '1px solid var(--border)' }}>
            {address}
          </code>
          <button onClick={() => copy(address!)} className="btn btn-ghost">
            {copied ? <CheckCircle size={16} color="var(--primary-dark)" /> : <Copy size={16} />}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <a href="https://faucet.zecpages.com/" target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>
            Claim ZEC <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Edit */}
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Edit details</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Display Name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: '100%', padding: '11px 14px', fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Bio</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} style={{ width: '100%', padding: '11px 14px', fontSize: 14, minHeight: 90, resize: 'vertical' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7, color: 'var(--muted-2)' }}>Skills (comma separated)</label>
            <input value={skills} onChange={(e) => setSkills(e.target.value)} style={{ width: '100%', padding: '11px 14px', fontSize: 14 }} />
          </div>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ padding: 12 }}>
            {saving ? <Loader2 size={15} className="spin" /> : saved ? <CheckCircle size={15} /> : null}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      <button onClick={() => { clearWallet(); router.push('/') }} className="btn btn-ghost" style={{ color: '#ef4444' }}>
        <LogOut size={15} /> Disconnect wallet
      </button>
    </div>
  )
}
