'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet, WalletChallenge } from '@/components/WalletContext'
import { ZcashNetwork } from '@/lib/zcash'
import { Briefcase, PenTool, Loader2, ArrowRight, ArrowLeft, ShieldCheck, Wallet, Copy, Check, LockKeyhole } from 'lucide-react'

const fieldStyle = { width: '100%', padding: '12px 14px', fontSize: 14 }
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 } as const
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

export default function OnboardingPage() {
  const router = useRouter()
  const { walletAddress, network: connectedNetwork, profile, beginConnection, verifyConnection, clearWallet, saveProfile, isConnected, isLoading, error: sessionError } = useWallet()
  const [stage, setStage] = useState<'wallet' | 'signature' | 'profile'>('wallet')
  const [walletInput, setWalletInput] = useState('')
  const [network, setNetwork] = useState<ZcashNetwork>('testnet')
  const [challenge, setChallenge] = useState<WalletChallenge | null>(null)
  const [signature, setSignature] = useState('')
  const [roleChoice, setRoleChoice] = useState<'freelancer' | 'client' | null>(null)
  const [nameInput, setNameInput] = useState<string | null>(null)
  const [bioInput, setBioInput] = useState<string | null>(null)
  const [skillsInput, setSkillsInput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const activeStage = isConnected ? 'profile' : stage === 'profile' ? 'wallet' : stage
  const activeIndex = activeStage === 'wallet' ? 0 : activeStage === 'signature' ? 1 : 2
  const role = roleChoice ?? (profile?.role === 'client' ? 'client' : 'freelancer')
  const displayName = nameInput ?? profile?.displayName ?? ''
  const bio = bioInput ?? profile?.bio ?? ''
  const skills = skillsInput ?? profile?.skills.join(', ') ?? ''

  async function startConnection(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const address = walletInput.trim()
    const prefix = network === 'testnet' ? 'tm' : 't1'
    if (!address.startsWith(prefix)) { setError(`Use an existing ${network} P2PKH address starting with ${prefix}, or select the matching network.`); return }
    const next = await beginConnection(address)
    if (next) { setChallenge(next); setSignature(''); setCopied(null); setStage('signature') }
  }

  async function confirmSignature(event: React.FormEvent) {
    event.preventDefault()
    if (!challenge || !signature.trim()) { setError('Paste the signature returned by your wallet.'); return }
    setError('')
    const connected = await verifyConnection(challenge.challengeToken, signature.trim())
    if (connected) { setSignature(''); setChallenge(null); setStage('profile') }
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

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setError('') }
    catch { setError('Clipboard unavailable. Select and copy the complete text manually.') }
  }

  async function switchWallet() {
    await clearWallet()
    setStage('wallet')
    setChallenge(null)
    setSignature('')
    setNameInput(null)
    setBioInput(null)
    setSkillsInput(null)
    setRoleChoice(null)
  }

  const rpc = challenge ? JSON.stringify({ jsonrpc: '2.0', id: 'zcashed-connect', method: 'signmessage', params: [walletInput.trim(), challenge.message] }, null, 2) : ''
  const command = challenge ? `zcash-cli${network === 'testnet' ? ' -testnet' : ''} signmessage ${shellQuote(walletInput.trim())} ${shellQuote(challenge.message)}` : ''

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--primary-dark)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10 }}><LockKeyhole size={14} /> WALLET CONNECTION</div>
        <h1 style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>Connect your existing Zcash wallet</h1>
        <p style={{ color: 'var(--muted-2)', fontSize: 15, lineHeight: 1.7, maxWidth: 620 }}>Use a wallet ownership signature to sign in. Keep spending keys in your wallet. Job deposits are held by the operator’s custodial testnet vault.</p>
      </div>
      <ol aria-label="Connection progress" className="grid grid-cols-3 gap-2" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {['Choose wallet', 'Sign message', 'Your profile'].map((label, index) => <li key={label} aria-current={index === activeIndex ? 'step' : undefined} style={{ borderTop: `3px solid ${index <= activeIndex ? 'var(--primary)' : 'var(--border-2)'}`, paddingTop: 10, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: index <= activeIndex ? 'var(--text)' : 'var(--muted)' }}><span>{index < activeIndex ? <Check size={15} /> : `${index + 1}.`}</span>{label}</li>)}
      </ol>
      {isLoading && activeStage === 'wallet' && <p role="status" style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12 }}>Checking your wallet session…</p>}
      <div className="card" style={{ padding: 24 }}>
        {activeStage === 'wallet' && <form onSubmit={startConnection} style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Wallet size={26} style={{ color: 'var(--primary-dark)' }} /><div><h2 style={{ fontSize: 20, fontWeight: 700 }}>Choose a wallet you already control</h2><p style={{ color: 'var(--muted-2)', fontSize: 13, marginTop: 4 }}>Supported signing method: Zallet or zcashd <code>signmessage</code>.</p></div></div>
          <div>
            <label htmlFor="connect-network" style={labelStyle}>Wallet network</label>
            <select id="connect-network" value={network} onChange={(event) => { setNetwork(event.target.value as ZcashNetwork); setError('') }} style={fieldStyle}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select>
          </div>
          <div>
            <label htmlFor="connect-address" style={labelStyle}>Wallet sign-in address</label>
            <input id="connect-address" value={walletInput} onChange={(event) => { setWalletInput(event.target.value); setError('') }} placeholder={network === 'testnet' ? 'Existing tm… address from your wallet' : 'Existing t1… address from your wallet'} required maxLength={120} autoComplete="off" spellCheck={false} style={{ ...fieldStyle, fontFamily: 'var(--font-geist-mono)', fontSize: 13 }} aria-describedby="signin-address-help" />
            <p id="signin-address-help" style={{ color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>Use an existing transparent P2PKH address whose key your wallet can sign with. The server checks ownership; pasting an address alone does not connect a wallet. A shielded payout address is entered privately when work is approved.</p>
          </div>
          <button type="submit" disabled={isLoading} className="btn btn-primary" style={{ minHeight: 46 }}>{isLoading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />} Continue to wallet signature</button>
        </form>}
        {activeStage === 'signature' && challenge && <form onSubmit={confirmSignature} style={{ display: 'grid', gap: 18 }}>
          <div><h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Sign this message in your wallet</h2><p style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.7 }}>Read the message and check that it names this site before signing. This signature is for connection only; it gives the app no spending authority.</p></div>
          <div style={{ fontSize: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, overflowWrap: 'anywhere' }}><strong>{network === 'testnet' ? 'Testnet' : 'Mainnet'}</strong> · {walletInput.trim()}</div>
          <div>
            <label htmlFor="connect-message" style={labelStyle}>Exact message to sign</label>
            <textarea id="connect-message" value={challenge.message} readOnly rows={9} style={{ ...fieldStyle, fontFamily: 'var(--font-geist-mono)', fontSize: 12, overflowWrap: 'anywhere' }} />
            <button type="button" onClick={() => { void copy(challenge.message, 'message') }} className="btn btn-outline" style={{ marginTop: 8, minHeight: 44 }}><Copy size={14} />{copied === 'message' ? 'Message copied' : 'Copy exact message'}</button>
          </div>
          <details style={{ fontSize: 13, color: 'var(--muted-2)' }}><summary style={{ cursor: 'pointer', padding: '8px 0', fontWeight: 600 }}>How to sign with Zallet or zcashd</summary>
            <p style={{ fontSize: 12, lineHeight: 1.7, margin: '10px 0' }}>Use your existing local wallet RPC connection. For Zallet, call <code>signmessage</code> with these exact JSON-RPC parameters. Only the returned base64 signature belongs in the next field.</p>
            <textarea aria-label="Zallet signmessage JSON-RPC request" value={rpc} readOnly rows={8} style={{ ...fieldStyle, fontFamily: 'var(--font-geist-mono)', fontSize: 11 }} />
            <button type="button" onClick={() => { void copy(rpc, 'rpc') }} className="btn btn-outline" style={{ marginTop: 8, minHeight: 44 }}><Copy size={14} />{copied === 'rpc' ? 'RPC request copied' : 'Copy RPC request'}</button>
            <p style={{ fontSize: 12, lineHeight: 1.7, margin: '16px 0 8px' }}>If you already use zcashd and its CLI, run this command locally:</p>
            <textarea aria-label="zcash-cli signmessage command" value={command} readOnly rows={5} style={{ ...fieldStyle, fontFamily: 'var(--font-geist-mono)', fontSize: 11 }} />
            <button type="button" onClick={() => { void copy(command, 'command') }} className="btn btn-outline" style={{ marginTop: 8, minHeight: 44 }}><Copy size={14} />{copied === 'command' ? 'Command copied' : 'Copy CLI command'}</button>
          </details>
          <div>
            <label htmlFor="connect-signature" style={labelStyle}>Wallet signature</label>
            <textarea id="connect-signature" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Paste the base64 signature returned by signmessage" rows={3} required maxLength={200} autoComplete="off" spellCheck={false} style={{ ...fieldStyle, fontFamily: 'var(--font-geist-mono)', fontSize: 12 }} />
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>The challenge expires shortly. If it expires, go back to request a new message.</p>
          <div className="flex flex-wrap gap-3"><button type="button" disabled={isLoading} onClick={() => { setStage('wallet'); setChallenge(null); setSignature(''); setError('') }} className="btn btn-outline" style={{ minHeight: 46 }}><ArrowLeft size={15} />Back</button><button type="submit" disabled={isLoading} className="btn btn-primary" style={{ flex: 1, minHeight: 46 }}>{isLoading ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} Verify and connect wallet</button></div>
        </form>}
        {activeStage === 'profile' && <form onSubmit={finish} style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 10, background: 'var(--primary-glow)' }}><ShieldCheck size={22} style={{ color: 'var(--primary-dark)', flexShrink: 0 }} /><div><h2 style={{ fontSize: 16, fontWeight: 700 }}>Wallet ownership verified</h2><p style={{ fontSize: 12, color: 'var(--muted-2)', overflowWrap: 'anywhere', marginTop: 5 }}>{connectedNetwork} · {walletAddress}</p></div></div>
          <div><h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Make yourself known</h2><p style={{ color: 'var(--muted-2)', fontSize: 13 }}>Choose a role and the name others will see on your work.</p></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={labelStyle}>I want to…</legend><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ value: 'freelancer' as const, icon: PenTool, title: 'Find work', description: 'Apply, deliver, and receive private ZEC payments.' }, { value: 'client' as const, icon: Briefcase, title: 'Hire talent', description: 'Post work and pay from your own Zcash wallet.' }].map((option) => <button key={option.value} type="button" aria-pressed={role === option.value} onClick={() => setRoleChoice(option.value)} style={{ padding: 18, textAlign: 'left', borderRadius: 10, border: role === option.value ? '2px solid var(--primary)' : '1px solid var(--border-2)', background: role === option.value ? 'var(--primary-glow)' : 'var(--surface)', minHeight: 105 }}><option.icon size={20} style={{ marginBottom: 8, color: 'var(--primary-dark)' }} /><span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{option.title}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.6, marginTop: 4 }}>{option.description}</span></button>)}
          </div></fieldset>
          <div><label htmlFor="profile-name" style={labelStyle}>Display name</label><input id="profile-name" value={displayName} maxLength={100} onChange={(event) => setNameInput(event.target.value)} placeholder="e.g. Alex the Developer" style={fieldStyle} /></div>
          <div><label htmlFor="profile-bio" style={labelStyle}>Bio</label><textarea id="profile-bio" value={bio} maxLength={2000} onChange={(event) => setBioInput(event.target.value)} placeholder="A few details about your work…" style={{ ...fieldStyle, minHeight: 90 }} /></div>
          {role === 'freelancer' && <div><label htmlFor="profile-skills" style={labelStyle}>Skills (comma separated)</label><input id="profile-skills" value={skills} maxLength={1000} onChange={(event) => setSkillsInput(event.target.value)} placeholder="React, Design, Research…" style={fieldStyle} /></div>}
          <button type="submit" disabled={saving || isLoading} className="btn btn-primary" style={{ minHeight: 46 }}>{saving ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}{saving ? 'Saving profile…' : role === 'client' ? 'Continue to post a job' : 'Continue to find work'}</button>
          <button type="button" onClick={() => { void switchWallet() }} disabled={isLoading || saving} className="btn btn-ghost" style={{ minHeight: 44 }}>Use another wallet</button>
        </form>}
        {(error || sessionError) && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, lineHeight: 1.6, marginTop: 16 }}>{error || sessionError}</p>}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '20px 4px', color: 'var(--muted-2)', fontSize: 12, lineHeight: 1.7 }}><LockKeyhole size={16} style={{ marginTop: 2, flexShrink: 0 }} /><p>The server receives your sign-in address to verify the signature. Public jobs use a separate application identity. Shielded payout addresses stay in private server records for the authorized vault payout.</p></div>
    </div>
  )
}
