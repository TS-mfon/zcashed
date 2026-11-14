// @vitest-environment jsdom
import { Suspense, useState } from 'react'
import { execFileSync } from 'node:child_process'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PaymentHandoff from '../components/PaymentHandoff'
import { WalletProvider, useWallet } from '../components/WalletContext'
import OnboardingPage from '../app/onboarding/page'
import JobDetailPage from '../app/jobs/[id]/page'
import NewJobPage from '../app/jobs/new/page'
import { POST as disabledWalletGeneration } from '../app/api/wallet/route'
import vectors from './fixtures/zcash-vectors.json'

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); routerPush.mockReset() })

function enterRecipient(address = vectors.unifiedTestnet) {
  fireEvent.change(screen.getByLabelText('Recipient shielded address'), { target: { value: address } })
  fireEvent.click(screen.getByLabelText(/I confirmed this address/))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet request' }))
}

describe('private wallet handoff', () => {
  it('requires human recipient confirmation before opening a native wallet request', async () => {
    const network = vi.fn(() => Promise.reject(new Error('Payment details must stay in this browser')))
    vi.stubGlobal('fetch', network)
    render(<PaymentHandoff amountZatoshis={10000} />)
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Recipient shielded address'), { target: { value: vectors.unifiedTestnet } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet request' }))
    expect(screen.getByRole('alert').textContent).toMatch(/confirm.*recipient/i)
    fireEvent.click(screen.getByLabelText(/I confirmed this address/))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare wallet request' }))
    const link = await screen.findByRole('link', { name: /Open in Zcash wallet/ })
    expect(link.getAttribute('href')).toMatch(/^zcash:utest1.*\?amount=0.0001&memo=/)
    expect(screen.getByText(/locally by your wallet/).textContent).toMatch(/signed locally/)
    expect(screen.getByText(/does not confirm payment/)).toBeTruthy()
    await waitFor(() => expect(screen.getByAltText('Zcash wallet payment request QR code')).toBeTruthy())
    expect(network).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('rejects a mainnet address in the default testnet flow', () => {
    render(<PaymentHandoff amountZatoshis={10000} />)
    enterRecipient(vectors.orchardOnly)
    expect(screen.getByRole('alert').textContent).toMatch(/mainnet/)
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
  })

  it('rejects a Unified Address with transparent fallback in the mainnet flow', () => {
    render(<PaymentHandoff amountZatoshis={10000} />)
    fireEvent.change(screen.getByLabelText('Zcash network'), { target: { value: 'mainnet' } })
    enterRecipient(vectors.transparentAndShielded)
    expect(screen.getByRole('alert').textContent).toMatch(/transparent fallback/)
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
  })

  it('invalidates a prepared request when the recipient changes', async () => {
    render(<PaymentHandoff amountZatoshis={10000} />)
    enterRecipient()
    await screen.findByRole('link', { name: /Open in Zcash wallet/ })
    fireEvent.change(screen.getByLabelText('Recipient shielded address'), { target: { value: vectors.saplingTestnet } })
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
    expect((screen.getByLabelText(/I confirmed this address/) as HTMLInputElement).checked).toBe(false)
  })

  it('invalidates a prepared request when the network changes', async () => {
    render(<PaymentHandoff amountZatoshis={10000} />)
    enterRecipient()
    await screen.findByRole('link', { name: /Open in Zcash wallet/ })
    fireEvent.change(screen.getByLabelText('Zcash network'), { target: { value: 'mainnet' } })
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
    expect((screen.getByLabelText(/I confirmed this address/) as HTMLInputElement).checked).toBe(false)
  })

  it('hides an obsolete request when the amount changes', async () => {
    const view = render(<PaymentHandoff amountZatoshis={10000} />)
    enterRecipient()
    await screen.findByRole('link', { name: /Open in Zcash wallet/ })
    view.rerender(<PaymentHandoff amountZatoshis={20000} />)
    expect(screen.queryByRole('link', { name: /Open in Zcash wallet/ })).toBeNull()
  })

  it('reports clipboard failure and leaves the URI available for manual copying', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error('blocked'))) } })
    render(<PaymentHandoff amountZatoshis={10000} />)
    enterRecipient()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy request' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Clipboard unavailable/))
    expect((screen.getByLabelText('Private payment request') as HTMLTextAreaElement).value).toMatch(/^zcash:/)
  })
})

function IdentityControls() {
  const identity = useWallet()
  const [challenge, setChallenge] = useState<{ message: string; challengeToken: string } | null>(null)
  return <div>
    <output aria-label="Identity">{identity.address ?? 'No identity'}</output>
    <output aria-label="Wallet address">{identity.walletAddress ?? 'No wallet'}</output>
    <output aria-label="Session loading">{identity.isLoading ? 'Loading' : 'Ready'}</output>
    <button onClick={async () => { setChallenge(await identity.beginConnection(vectors.transparentTestnet)) }}>Request ownership challenge</button>
    <output aria-label="Challenge">{challenge?.message ?? ''}</output>
    <button onClick={() => { if (challenge) void identity.verifyConnection(challenge.challengeToken, 'signed-challenge') }}>Verify signature</button>
    <button onClick={() => { void identity.clearWallet() }}>Disconnect wallet</button>
    <button onClick={() => { void identity.saveProfile({ address: 'untrusted-override', role: 'client', displayName: 'Client', bio: 'bio', skills: [] }) }}>Save profile</button>
    <button onClick={() => { void identity.refreshProfile() }}>Refresh profile</button>
    <output aria-label="Profile role">{identity.role ?? 'No role'}</output>
    <output aria-label="Session error">{identity.error}</output>
  </div>
}

describe('verified wallet session', () => {
  it('restores the signed session instead of trusting a saved wallet address', async () => {
    localStorage.setItem('zcashed_wallet_address', vectors.saplingTestnet)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(
      url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null },
    )))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-restored'))
    expect(screen.queryByText(vectors.saplingTestnet)).toBeNull()
    localStorage.clear()
  })

  it('does not restore an identity from local storage when the session is absent', async () => {
    localStorage.setItem('zcashed_wallet_address', vectors.saplingTestnet)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ address: null })))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
    expect(screen.queryByText(vectors.saplingTestnet)).toBeNull()
  })

  it('connects only after the existing wallet signs the server challenge', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/challenge') {
        expect(JSON.parse(options?.body as string)).toEqual({ walletAddress: vectors.transparentTestnet })
        return Response.json({ message: 'Exact server ownership challenge', challengeToken: 'one-use-token' })
      }
      if (options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ challengeToken: 'one-use-token', signature: 'signed-challenge' })
        return Response.json({ address: 'app-verified', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      }
      return Response.json(url === '/api/session' ? { address: null } : { profile: null })
    }))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    fireEvent.click(screen.getByText('Request ownership challenge'))
    await waitFor(() => expect(screen.getByLabelText('Challenge').textContent).toBe('Exact server ownership challenge'))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
    fireEvent.click(screen.getByText('Verify signature'))
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-verified'))
    expect(screen.getByLabelText('Wallet address').textContent).toBe(vectors.transparentTestnet)
  })

  it('revokes the session when disconnecting the wallet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => Response.json(
      url === '/api/session' ? options?.method === 'DELETE' ? { address: null } : { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null },
    )))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-restored'))
    fireEvent.click(screen.getByText('Disconnect wallet'))
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('No identity'))
  })

  it('reports session restore failures instead of accepting an editable address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Session verification unavailable' }, { status: 503 })))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/Session verification unavailable/))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
  })

  it('retains the session and reports an error if revocation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => options?.method === 'DELETE'
      ? Response.json({ error: 'unavailable' }, { status: 503 })
      : Response.json(url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null }),
    ))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-restored'))
    fireEvent.click(screen.getByText('Disconnect wallet'))
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/Could not disconnect/))
    expect(screen.getByLabelText('Identity').textContent).toBe('app-restored')
  })

  it('rejects a session response without a verified wallet address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ address: 'unverified-app-id', network: 'testnet' })))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/invalid wallet session/))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
  })

  it('retains a verified wallet session when profile storage is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/session'
      ? Response.json({ address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      : Response.json({ error: 'Profile storage unavailable' }, { status: 503 }),
    ))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    expect(screen.getByLabelText('Identity').textContent).toBe('app-restored')
    expect(screen.getByLabelText('Session error').textContent).toMatch(/Profile storage unavailable/)
  })

  it('shows an expired or rejected signature error without connecting the address', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/challenge') return Response.json({ message: 'Exact challenge', challengeToken: 'expired-token' })
      if (options?.method === 'POST') return Response.json({ error: 'Signature invalid or challenge expired' }, { status: 401 })
      return Response.json({ address: null })
    }))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    fireEvent.click(screen.getByText('Request ownership challenge'))
    await waitFor(() => expect(screen.getByLabelText('Challenge').textContent).toBe('Exact challenge'))
    fireEvent.click(screen.getByText('Verify signature'))
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/Signature invalid or challenge expired/))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
  })

  it('rejects an empty ownership challenge from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/auth/challenge' ? { message: '', challengeToken: '' } : { address: null })))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    fireEvent.click(screen.getByText('Request ownership challenge'))
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/invalid ownership challenge/))
    expect(screen.getByLabelText('Identity').textContent).toBe('No identity')
  })

  it('saves only profile fields while retaining the server-authenticated identity', async () => {
    const profile = { address: 'app-restored', role: 'client', displayName: 'Client', bio: 'bio', skills: [], createdAt: '2026-11-14T00:00:00Z' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/profile' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ role: 'client', displayName: 'Client', bio: 'bio', skills: [] })
        return Response.json({ profile })
      }
      return Response.json(url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null })
    }))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-restored'))
    fireEvent.click(screen.getByText('Save profile'))
    await waitFor(() => expect(screen.getByLabelText('Profile role').textContent).toBe('client'))
    expect(screen.getByLabelText('Identity').textContent).toBe('app-restored')
  })

  it('reports a profile save failure and retains the authenticated wallet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ error: 'Profile field invalid' }, { status: 400 })
      : Response.json(url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null }),
    ))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Identity').textContent).toBe('app-restored'))
    fireEvent.click(screen.getByText('Save profile'))
    await waitFor(() => expect(screen.getByLabelText('Session error').textContent).toMatch(/Profile field invalid/))
    expect(screen.getByLabelText('Identity').textContent).toBe('app-restored')
  })

  it('refreshes the current profile from the authenticated API', async () => {
    let refreshed = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/session') return Response.json({ address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      const data = Response.json({ profile: refreshed ? { address: 'app-restored', role: 'client' } : null })
      refreshed = true
      return data
    }))
    render(<WalletProvider><IdentityControls /></WalletProvider>)
    await waitFor(() => expect(screen.getByLabelText('Session loading').textContent).toBe('Ready'))
    fireEvent.click(screen.getByText('Refresh profile'))
    await waitFor(() => expect(screen.getByLabelText('Profile role').textContent).toBe('client'))
  })
})

describe('disabled wallet generation', () => {
  it('returns 410 and never returns an address or private key', async () => {
    const response = await disabledWalletGeneration()
    expect(response.status).toBe(410)
    expect(Object.keys(await response.json())).toEqual(['error'])
  })
})

const sampleJob = {
  id: 'job-example', title: 'Write a public report', description: 'Explain how to verify a public work deliverable.', category: 'Writing',
  budgetZec: 0.0001, budgetZatoshis: 10000, assignmentMode: 'direct', clientAddress: 'app-client', workerAddress: 'app-worker',
  status: 'in_progress', genlayerContractAddress: '', deadline: null, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z',
  submissions: [], applications: [],
}

describe('work review and payment separation', () => {
  it('shows an inconclusive verdict separately and preserves the deliverable for revision', async () => {
    let reviewed = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/session') return Response.json({ address: 'app-worker', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      if (url.startsWith('/api/profile')) return Response.json({ profile: { address: 'app-worker', role: 'freelancer' } })
      if (url === '/api/submit' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string).attempt).toBe(1)
        reviewed = true
        return Response.json({ approved: false, verdict: 'inconclusive', rejectionReason: 'The evidence is insufficient to decide.' })
      }
      return Response.json({ job: { ...sampleJob, status: reviewed ? 'needs_revision' : 'in_progress' } })
    }))
    await act(async () => { render(<Suspense fallback="Loading job"><WalletProvider><JobDetailPage params={Promise.resolve({ id: sampleJob.id })} /></WalletProvider></Suspense>) })
    const deliverable = 'A complete public deliverable that can be evaluated.'
    fireEvent.change(await screen.findByLabelText(/Delivered work/), { target: { value: deliverable } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for AI Review →' }))
    expect(await screen.findByText('Review inconclusive')).toBeTruthy()
    expect(screen.queryByText(/payment released/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clarify & Resubmit' }))
    expect((await screen.findByLabelText(/Delivered work/) as HTMLTextAreaElement).value).toBe(deliverable)
  })

  it('reports a provider failure and keeps the work editable for another review', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/session') return Response.json({ address: 'app-worker', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      if (url.startsWith('/api/profile')) return Response.json({ profile: { address: 'app-worker', role: 'freelancer' } })
      if (url === '/api/submit' && options?.method === 'POST') return Response.json({ error: 'GenLayer provider unavailable. Try again.' }, { status: 503 })
      return Response.json({ job: sampleJob })
    }))
    await act(async () => { render(<Suspense fallback="Loading job"><WalletProvider><JobDetailPage params={Promise.resolve({ id: sampleJob.id })} /></WalletProvider></Suspense>) })
    const deliverable = 'A complete public deliverable that can be evaluated.'
    fireEvent.change(await screen.findByLabelText(/Delivered work/), { target: { value: deliverable } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for AI Review →' }))
    expect(await screen.findByText('GenLayer provider unavailable. Try again.')).toBeTruthy()
    expect((screen.getByLabelText(/Delivered work/) as HTMLTextAreaElement).value).toBe(deliverable)
    expect(screen.queryByText('Work Approved! 🎉')).toBeNull()
  })

  it('offers the third review attempt with the previous deliverable preserved', async () => {
    const previous = 'The previous public deliverable needs a small correction.'
    const submissions = [1, 2].map((attempt) => ({ id: `sub-${attempt}`, jobId: sampleJob.id, workerAddress: 'app-worker', submissionUrl: '', notes: previous, status: 'needs_revision', aiFeedback: 'Add the missing source.', attempt, genlayerTxHash: '', createdAt: `2026-11-14T00:00:0${attempt}Z` }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/session') return Response.json({ address: 'app-worker', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      if (url.startsWith('/api/profile')) return Response.json({ profile: { address: 'app-worker', role: 'freelancer' } })
      return Response.json({ job: { ...sampleJob, status: 'needs_revision', submissions } })
    }))
    await act(async () => { render(<Suspense fallback="Loading job"><WalletProvider><JobDetailPage params={Promise.resolve({ id: sampleJob.id })} /></WalletProvider></Suspense>) })
    expect(await screen.findByText('Attempt 3 of 3')).toBeTruthy()
    expect((screen.getByLabelText(/Delivered work/) as HTMLTextAreaElement).value).toBe(previous)
  })

  it('blocks further work submissions after three judged attempts', async () => {
    const submissions = [1, 2, 3].map((attempt) => ({ id: `sub-${attempt}`, jobId: sampleJob.id, workerAddress: 'app-worker', submissionUrl: '', notes: 'Rejected delivered work.', status: 'rejected', aiFeedback: 'Requirements not met.', attempt, genlayerTxHash: '', createdAt: `2026-11-14T00:00:0${attempt}Z` }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/session') return Response.json({ address: 'app-worker', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      if (url.startsWith('/api/profile')) return Response.json({ profile: { address: 'app-worker', role: 'freelancer' } })
      return Response.json({ job: { ...sampleJob, status: 'rejected', submissions } })
    }))
    await act(async () => { render(<Suspense fallback="Loading job"><WalletProvider><JobDetailPage params={Promise.resolve({ id: sampleJob.id })} /></WalletProvider></Suspense>) })
    expect(await screen.findByText('All 3 review attempts used')).toBeTruthy()
    expect(screen.queryByLabelText(/Delivered work/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Resubmit/ })).toBeNull()
  })

  it('creates a job with integer zatoshis and redirects to its funding page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/session') return Response.json({ address: 'app-client', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      if (url.startsWith('/api/profile')) return Response.json({ profile: { address: 'app-client', role: 'client' } })
      if (url === '/api/jobs' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string)
        expect(body.budgetZatoshis).toBe(1)
        expect(body.budgetZec).toBeUndefined()
        expect(body.clientAddress).toBeUndefined()
        return Response.json({ job: { ...sampleJob, status: 'funding_required', vaultAddress: vectors.unifiedTestnet, vaultReference: 'opaque-reference', vaultNetwork: 'testnet', fundedAt: null, fundedZatoshis: 0 } })
      }
      throw new Error('Unexpected request')
    }))
    render(<WalletProvider><NewJobPage /></WalletProvider>)
    fireEvent.change(await screen.findByLabelText(/Job Title/), { target: { value: sampleJob.title } })
    fireEvent.change(screen.getByLabelText(/Task Description/), { target: { value: sampleJob.description } })
    fireEvent.change(screen.getByLabelText(/Budget \(ZEC\)/), { target: { value: '0.00000001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create job & continue to funding' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/jobs/job-example'))
    expect(screen.queryByText('Job is Live!')).toBeNull()
  })
})

describe('existing wallet onboarding', () => {
  it('walks through challenge signing and profile setup without generating wallet keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/auth/challenge') return Response.json({ message: 'ZCashed sign-in only\nDomain: localhost\nNonce: random', challengeToken: 'challenge-token' })
      if (url === '/api/session' && options?.method === 'POST') return Response.json({ address: 'app-verified', walletAddress: vectors.transparentTestnet, network: 'testnet' })
      return Response.json(url === '/api/session' ? { address: null } : { profile: null })
    }))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    await screen.findByRole('button', { name: 'Continue to wallet signature' })
    expect(screen.queryByText(/Generate.*wallet/i)).toBeNull()
    fireEvent.change(screen.getByLabelText('Wallet sign-in address'), { target: { value: vectors.transparentTestnet } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to wallet signature' }))
    expect(await screen.findByLabelText('Exact message to sign')).toBeTruthy()
    expect(screen.getByText(/connection only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Wallet signature'), { target: { value: 'signed-challenge' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and connect wallet' }))
    expect(await screen.findByLabelText('Display name')).toBeTruthy()
    expect(screen.getByText('Wallet ownership verified')).toBeTruthy()
  })

  it('lets a connected client update a profile and continue to posting work', async () => {
    const existing = { address: 'app-restored', role: 'client', displayName: 'Existing Name', bio: 'Existing bio', skills: [], createdAt: '2026-11-14T00:00:00Z' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/profile' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ role: 'client', displayName: 'Updated Name', bio: 'Updated bio', skills: [] })
        return Response.json({ profile: { ...existing, displayName: 'Updated Name', bio: 'Updated bio' } })
      }
      return Response.json(url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: existing })
    }))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    const name = await screen.findByLabelText('Display name') as HTMLInputElement
    expect(name.value).toBe('Existing Name')
    fireEvent.change(name, { target: { value: 'Updated Name' } })
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Updated bio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to post a job' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/jobs/new'))
  })

  it('lets a connected freelancer save selected skills and continue to finding work', async () => {
    const profile = { address: 'app-restored', role: 'freelancer', displayName: 'Developer', bio: 'A developer', skills: ['React', 'Design'], createdAt: '2026-11-14T00:00:00Z' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/profile' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ role: 'freelancer', displayName: 'Developer', bio: 'A developer', skills: ['React', 'Design'] })
        return Response.json({ profile })
      }
      return Response.json(url === '/api/session' ? { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' } : { profile: null })
    }))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: ' Developer ' } })
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: ' A developer ' } })
    fireEvent.click(screen.getByRole('button', { name: /Hire talent/ }))
    expect(screen.queryByLabelText('Skills (comma separated)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Find work/ }))
    fireEvent.change(screen.getByLabelText('Skills (comma separated)'), { target: { value: ' React, , Design ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to find work' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/jobs'))
  })

  it('signs the exact server text through copyable RPC and safely quoted CLI instructions', async () => {
    const exact = "Own this wallet's session.\nDo not run $(printf unsafe) or `printf unsafe`."
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (text: string) => { copied.push(text) }) } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/auth/challenge' ? { message: exact, challengeToken: 'challenge-token' } : { address: null })))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    const next = await screen.findByRole('button', { name: 'Continue to wallet signature' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Wallet sign-in address'), { target: { value: vectors.transparentTestnet } })
    fireEvent.click(next)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy exact message' }))
    await screen.findByRole('button', { name: 'Message copied' })
    fireEvent.click(screen.getByText('How to sign with Zallet or zcashd'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy RPC request' }))
    await screen.findByRole('button', { name: 'RPC request copied' })
    fireEvent.click(screen.getByRole('button', { name: 'Copy CLI command' }))
    await screen.findByRole('button', { name: 'Command copied' })
    expect(copied[0]).toBe(exact)
    expect(JSON.parse(copied[1])).toEqual({ jsonrpc: '2.0', id: 'zcashed-connect', method: 'signmessage', params: [vectors.transparentTestnet, exact] })
    // Capture argv instead of calling any wallet. Shell metacharacters must stay literal.
    const script = `zcash-cli() { node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"; }\n${copied[2]}`
    expect(JSON.parse(execFileSync('bash', ['-c', script], { encoding: 'utf8' }))).toEqual(['-testnet', 'signmessage', vectors.transparentTestnet, exact])
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Wallet sign-in address')).toBeTruthy()
    expect(screen.queryByLabelText('Exact message to sign')).toBeNull()
  })

  it('keeps the user on the signing step when copying is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error('clipboard denied'))) } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/auth/challenge' ? { message: 'Exact sign-in message', challengeToken: 'challenge-token' } : { address: null })))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    const next = await screen.findByRole('button', { name: 'Continue to wallet signature' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Wallet sign-in address'), { target: { value: vectors.transparentTestnet } })
    fireEvent.click(next)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy exact message' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Clipboard unavailable/))
    expect((screen.getByLabelText('Exact message to sign') as HTMLTextAreaElement).value).toBe('Exact sign-in message')
  })

  it('requires the chosen network to match the existing sign-in address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ address: null })))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    const next = await screen.findByRole('button', { name: 'Continue to wallet signature' })
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Wallet sign-in address'), { target: { value: vectors.transparentMainnet } })
    fireEvent.click(next)
    expect(screen.getByRole('alert').textContent).toMatch(/testnet.*tm/)
    fireEvent.change(screen.getByLabelText('Wallet network'), { target: { value: 'mainnet' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disconnects the current wallet before offering another connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => Response.json(url === '/api/session'
      ? options?.method === 'DELETE' ? { address: null } : { address: 'app-restored', walletAddress: vectors.transparentTestnet, network: 'testnet' }
      : { profile: null },
    )))
    render(<WalletProvider><OnboardingPage /></WalletProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Use another wallet' }))
    expect(await screen.findByLabelText('Wallet sign-in address')).toBeTruthy()
    expect(screen.queryByText('Wallet ownership verified')).toBeNull()
  })
})
