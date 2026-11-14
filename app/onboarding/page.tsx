'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletContext'
import { Briefcase, PenTool, Loader2, ArrowRight, ShieldCheck, Wallet, Check, LockKeyhole } from 'lucide-react'

const fieldStyle = { width: '100%', padding: '12px 14px', fontSize: 14 }
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 } as const

export default function OnboardingPage() {
  const router = useRouter()
  const { walletAddress, username, network: connectedNetwork, profile, openWalletPicker, clearWallet, saveProfile, registerAccount, loginAccount, isConnected, isLoading, error: sessionError } = useWallet()
  const [accountMode, setAccountMode] = useState<'register' | 'login'>('register')
  const [usernameInput, setUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [confirmationInput, setConfirmationInput] = useState('')
  const [roleChoice, setRoleChoice] = useState<'freelancer' | 'client' | null>(null)
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [bioInput, setBioInput] = useState<string | null>(null)
  const [skillsInput, setSkillsInput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const activeStage = isConnected ? username ? 'profile' : 'account' : 'wallet'
  const activeIndex = activeStage === 'profile' ? 2 : activeStage === 'account' ? 1 : 0
  const role = roleChoice ?? (profile?.role === 'client' ? 'client' : 'freelancer')
  const displayName = nameInput ?? profile?.displayName ?? username ?? ''
  const bio = bioInput ?? profile?.bio ?? ''
  const skills = skillsInput ?? profile?.skills.join(', ') ?? ''

  async function authenticate(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (accountMode === 'register' && passwordInput !== confirmationInput) { setError('Your passwords do not match.'); return }
    const success = await (accountMode === 'register' ? registerAccount : loginAccount)(usernameInput, passwordInput)
    if (success) { setPasswordInput(''); setConfirmationInput('') }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const saved = await saveProfile({
      role,
      displayName: displayName.trim() || (role === 'client' ? 'Client' : 'Freelancer'),
      bio: bio.trim(),
      skills: role === 'freelancer' ? skills.split(',').map((skill) => skill.trim()).filter(Boolean) : [],
    })
    setSaving(false)
    if (saved) router.push(role === 'client' ? '/jobs/new' : '/jobs')
  }

  async function switchWallet() {
    await clearWallet()
    setNameInput(null)
    setBioInput(null)
    setSkillsInput(null)
    setRoleChoice(null)
    setPasswordInput('')
    setConfirmationInput('')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--primary-dark)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10 }}><LockKeyhole size={14} /> WALLET AND ACCOUNT</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>{username ? `Welcome, @${username}` : 'Connect your wallet. Make your account yours.'}</h1>
        <p style={{ color: 'var(--muted-2)', fontSize: 15, lineHeight: 1.7, maxWidth: 620 }}>Connect Zucchini on testnet, then create your unique username or sign in. Your username keeps your jobs and claims together when you reconnect.</p>
      </div>
      <ol aria-label="Connection progress" className="grid grid-cols-3 gap-2" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {['Choose wallet', 'Your username', 'Your profile'].map((label, index) => <li key={label} aria-current={index === activeIndex ? 'step' : undefined} style={{ borderTop: `3px solid ${index <= activeIndex ? 'var(--primary)' : 'var(--border-2)'}`, paddingTop: 10, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: index <= activeIndex ? 'var(--text)' : 'var(--muted)' }}><span>{index < activeIndex ? <Check size={15} /> : `${index + 1}.`}</span>{label}</li>)}
      </ol>
      {isLoading && activeStage === 'wallet' && <p role="status" style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12 }}>Checking your wallet session…</p>}
      <div className="card" style={{ padding: 24 }}>
        {activeStage === 'wallet' && <div style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Wallet size={26} style={{ color: 'var(--primary-dark)' }} /><div><h2 style={{ fontSize: 20, fontWeight: 700 }}>Choose your testnet wallet</h2><p style={{ color: 'var(--muted-2)', fontSize: 13, marginTop: 4 }}>Connect a detected browser wallet with a testnet Unified Account.</p></div></div>
          <p style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.7 }}>The wallet picker requests account access through Zucchini. Your account address starts with <code>utest1</code>. This app supports testnet only.</p>
          <button type="button" onClick={openWalletPicker} disabled={isLoading} className="btn btn-primary" style={{ minHeight: 46 }}>{isLoading ? <Loader2 size={16} className="spin" /> : <Wallet size={16} />} Connect wallet</button>
        </div>}
        {activeStage === 'account' && <form onSubmit={authenticate} style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 10, background: 'var(--primary-glow)' }}><ShieldCheck size={22} style={{ color: 'var(--primary-dark)', flexShrink: 0 }} /><div><h2 style={{ fontSize: 16, fontWeight: 700 }}>Testnet wallet connected</h2><p style={{ fontSize: 12, color: 'var(--muted-2)', overflowWrap: 'anywhere', marginTop: 5 }}>{walletAddress}</p></div></div>
          <div><h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{accountMode === 'register' ? 'Claim your unique username' : 'Welcome back'}</h2><p style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.7 }}>{accountMode === 'register' ? 'Your username belongs to your account. Save your password so you can recover your jobs after disconnecting.' : 'Sign in with your username and password to restore your profile, jobs, and claims.'}</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`btn ${accountMode === 'register' ? 'btn-primary' : 'btn-outline'}`} aria-pressed={accountMode === 'register'} disabled={isLoading} onClick={() => { setAccountMode('register'); setError('') }}>Create account</button>
            <button type="button" className={`btn ${accountMode === 'login' ? 'btn-primary' : 'btn-outline'}`} aria-pressed={accountMode === 'login'} disabled={isLoading} onClick={() => { setAccountMode('login'); setError('') }}>Sign in</button>
          </div>
          <div><label htmlFor="account-username" style={labelStyle}>Username</label><input id="account-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={usernameInput} onChange={event => setUsernameInput(event.target.value.toLowerCase())} minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" required placeholder="e.g. alex_writer" aria-describedby="username-help" style={fieldStyle} /><p id="username-help" style={{ color: 'var(--muted-2)', fontSize: 12, marginTop: 6 }}>3–24 letters, numbers, or underscores. Usernames are unique and cannot be changed.</p></div>
          <div><label htmlFor="account-password" style={labelStyle}>Password</label><input id="account-password" name="password" type="password" autoComplete={accountMode === 'register' ? 'new-password' : 'current-password'} value={passwordInput} onChange={event => setPasswordInput(event.target.value)} minLength={8} maxLength={128} required style={fieldStyle} /></div>
          {accountMode === 'register' && <div><label htmlFor="account-confirmation" style={labelStyle}>Confirm password</label><input id="account-confirmation" name="password-confirmation" type="password" autoComplete="new-password" value={confirmationInput} onChange={event => setConfirmationInput(event.target.value)} minLength={8} maxLength={128} required style={fieldStyle} /></div>}
          <button type="submit" disabled={isLoading} className="btn btn-primary" style={{ minHeight: 46 }}>{isLoading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}{isLoading ? 'Connecting your account…' : accountMode === 'register' ? 'Create my account' : 'Sign in and restore my account'}</button>
        </form>}
        {activeStage === 'profile' && <form onSubmit={finish} style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 10, background: 'var(--primary-glow)' }}><ShieldCheck size={22} style={{ color: 'var(--primary-dark)', flexShrink: 0 }} /><div><h2 style={{ fontSize: 16, fontWeight: 700 }}>Wallet connected</h2><p style={{ fontSize: 12, color: 'var(--muted-2)', overflowWrap: 'anywhere', marginTop: 5 }}>{connectedNetwork} · {walletAddress}</p></div></div>
          <div><h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Your profile · @{username}</h2><p style={{ color: 'var(--muted-2)', fontSize: 13 }}>Choose your role and add a few details about your work.</p></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={labelStyle}>I want to…</legend><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ value: 'freelancer' as const, icon: PenTool, title: 'Find work', description: 'Apply, deliver, and receive private ZEC payments.' }, { value: 'client' as const, icon: Briefcase, title: 'Hire talent', description: 'Post work and pay from your own Zcash wallet.' }].map((option) => <button key={option.value} type="button" aria-pressed={role === option.value} onClick={() => setRoleChoice(option.value)} style={{ padding: 18, textAlign: 'left', borderRadius: 10, border: role === option.value ? '2px solid var(--primary)' : '1px solid var(--border-2)', background: role === option.value ? 'var(--primary-glow)' : 'var(--surface)', minHeight: 105 }}><option.icon size={20} style={{ marginBottom: 8, color: 'var(--primary-dark)' }} /><span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{option.title}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.6, marginTop: 4 }}>{option.description}</span></button>)}
          </div></fieldset>
          <div><label htmlFor="profile-name" style={labelStyle}>Display name</label><input id="profile-name" value={displayName} maxLength={80} onChange={(event) => setNameInput(event.target.value)} placeholder="e.g. Alex the Developer" style={fieldStyle} /></div>
          <div><label htmlFor="profile-bio" style={labelStyle}>Bio</label><textarea id="profile-bio" value={bio} maxLength={2000} onChange={(event) => setBioInput(event.target.value)} placeholder="A few details about your work…" style={{ ...fieldStyle, minHeight: 90 }} /></div>
          {role === 'freelancer' && <div><label htmlFor="profile-skills" style={labelStyle}>Skills (comma separated)</label><input id="profile-skills" value={skills} maxLength={1000} onChange={(event) => setSkillsInput(event.target.value)} placeholder="React, Design, Research…" style={fieldStyle} /></div>}
          <button type="submit" disabled={saving || isLoading} className="btn btn-primary" style={{ minHeight: 46 }}>{saving ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}{saving ? 'Saving profile…' : role === 'client' ? 'Continue to post a job' : 'Continue to find work'}</button>
          <button type="button" onClick={() => { void switchWallet() }} disabled={isLoading || saving} className="btn btn-ghost" style={{ minHeight: 44 }}>Use another wallet</button>
        </form>}
        {(error || sessionError) && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, lineHeight: 1.6, marginTop: 16 }}>{error || sessionError}</p>}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '20px 4px', color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7 }}><LockKeyhole size={16} style={{ marginTop: 2, flexShrink: 0 }} /><p>Your username identifies your account; your password restores access after you disconnect. Spending keys stay in your wallet. Job deposits remain in the operator’s custodial testnet vault, and shielded payout addresses stay in private server records.</p></div>
    </div>
  )
}
