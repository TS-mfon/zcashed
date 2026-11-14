'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { Copy, CheckCircle, Loader2, LogOut, ShieldCheck } from 'lucide-react'

export default function ProfilePage() {
  const { address, isConnected, isLoading } = useWallet()
  const router = useRouter()
  if (isLoading) return <div className="py-20 text-center" role="status"><Loader2 className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary-dark)' }} />Loading your profile…</div>
  if (!isConnected) return <div className="max-w-xl mx-auto px-4 py-20 text-center">
    <ShieldCheck size={36} style={{ margin: '0 auto 18px', color: 'var(--primary-dark)' }} />
    <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>Connect your existing wallet</h1>
    <p style={{ color: 'var(--muted-2)', marginBottom: 24 }}>Sign a wallet challenge to manage your profile.</p>
    <button onClick={() => router.push('/onboarding')} className="btn btn-primary">Connect wallet</button>
  </div>
  return <ProfileContent key={address} />
}

function ProfileContent() {
  const { address, profile, saveProfile, clearWallet, role, error } = useWallet()
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [bioInput, setBioInput] = useState<string | null>(null)
  const [skillsInput, setSkillsInput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  const displayName = nameInput ?? profile?.displayName ?? ''
  const bio = bioInput ?? profile?.bio ?? ''
  const skills = skillsInput ?? profile?.skills.join(', ') ?? ''
  const visibleError = message || error
  const fieldStyle = { width: '100%', padding: '12px 14px', fontSize: 15 }
  const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setMessage('')
    try {
      const result = await saveProfile({ displayName: displayName.trim(), bio: bio.trim(),
        skills: skills.split(',').map((skill) => skill.trim()).filter(Boolean) })
      if (!result) throw new Error('Could not save your profile. Please try again.')
      setNameInput(result.displayName)
      setBioInput(result.bio)
      setSkillsInput(result.skills.join(', '))
      setSaved(true)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not save your profile. Please try again.') }
    finally { setSaving(false) }
  }
  async function copy() {
    setMessage('')
    setCopied(false)
    try { await navigator.clipboard.writeText(address!); setCopied(true) }
    catch { setMessage('Clipboard unavailable. Select and copy your app identity below.') }
  }
  async function disconnect() {
    setMessage('')
    setDisconnecting(true)
    try { await clearWallet() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not disconnect your wallet. Please try again.') }
    finally { setDisconnecting(false) }
  }

  return <div className="max-w-2xl mx-auto px-4 py-10">
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 8 }}>Your profile</h1>
      <p style={{ color: 'var(--muted-2)', fontSize: 15, lineHeight: 1.65 }}>Introduce your work. Your name, bio, and skills are public.</p>
    </div>
    {visibleError && <div role="alert" className="card" style={{ borderColor: '#b45309', padding: 16, marginBottom: 20 }}>{visibleError}</div>}
    <section className="card" style={{ padding: 24, marginBottom: 20 }} aria-labelledby="identity-heading">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22 }}>
        <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--primary)', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800, color: 'var(--primary-ink)', flexShrink: 0 }}>{Array.from(displayName || 'Z')[0].toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere' }}>{displayName || 'Your public profile'}</h2>
          <p style={{ fontSize: 13, color: 'var(--muted-2)', textTransform: 'capitalize' }}>{role ?? 'No role selected'}</p>
        </div>
      </div>
      <h3 id="identity-heading" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Public app identity</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, minWidth: 0, fontSize: 12, background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8, overflowWrap: 'anywhere', border: '1px solid var(--border)' }}>{address}</code>
        <button onClick={copy} className="btn btn-ghost" aria-label="Copy public app identity" style={{ padding: 12 }}>{copied ? <CheckCircle size={18} /> : <Copy size={18} />}</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted-2)', marginTop: 12, lineHeight: 1.6 }}>This is your application identity, not a Zcash receive address. Your wallet signing address is kept out of this public profile.</p>
      {copied && <p role="status" style={{ marginTop: 10, fontSize: 13 }}>App identity copied.</p>}
    </section>
    <form className="card" onSubmit={save} style={{ padding: 24, marginBottom: 20 }} aria-labelledby="edit-heading">
      <h2 id="edit-heading" style={{ fontSize: 20, fontWeight: 700, marginBottom: 22 }}>Edit your details</h2>
      <div style={{ display: 'grid', gap: 20 }}>
        <div><label htmlFor="profile-display-name" style={labelStyle}>Display name</label><input id="profile-display-name" value={displayName} maxLength={100} required autoComplete="nickname" onChange={(event) => { setNameInput(event.target.value); setSaved(false) }} style={fieldStyle} /></div>
        <div><label htmlFor="profile-bio" style={labelStyle}>Bio</label><textarea id="profile-bio" value={bio} maxLength={2000} rows={4} onChange={(event) => { setBioInput(event.target.value); setSaved(false) }} style={{ ...fieldStyle, resize: 'vertical' }} /></div>
        <div><label htmlFor="profile-skills" style={labelStyle}>Skills (comma separated)</label><input id="profile-skills" value={skills} maxLength={1000} placeholder="Writing, Research, Design" onChange={(event) => { setSkillsInput(event.target.value); setSaved(false) }} style={fieldStyle} /></div>
        <button type="submit" disabled={saving || disconnecting} className="btn btn-primary" style={{ padding: 13 }}>{saving && <Loader2 size={16} className="spin" />}{saving ? 'Saving profile…' : 'Save changes'}</button>
        {saved && <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><CheckCircle size={16} />Profile saved.</p>}
      </div>
    </form>
    <button onClick={disconnect} disabled={saving || disconnecting} className="btn btn-outline"><LogOut size={16} />{disconnecting ? 'Disconnecting…' : 'Disconnect wallet'}</button>
  </div>
}
