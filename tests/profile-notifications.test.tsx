// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from '../app/profile/page'
import NotificationsPage from '../app/notifications/page'

const wallet = vi.hoisted(() => ({ useWallet: vi.fn(), save: vi.fn(), clear: vi.fn(), push: vi.fn() }))
vi.mock('../components/WalletContext', () => ({ useWallet: wallet.useWallet }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: wallet.push }) }))

const profile = { address: 'user_' + '1'.repeat(64), displayName: 'Alex', role: 'freelancer',
  bio: 'Public writing', skills: ['Writing'], createdAt: '2026-11-14T00:00:00Z' }
const note = { id: 'note1', recipientAddress: profile.address, type: 'work_submitted', title: 'Work ready for review',
  body: 'Review the public deliverable.', link: '/jobs/job1', read: false, createdAt: '2026-11-14T00:00:00Z' }

beforeEach(() => {
  vi.resetAllMocks()
  wallet.useWallet.mockReturnValue({ address: profile.address, walletAddress: 'tmPrivateSigningAddress', network: 'testnet',
    profile, role: profile.role, isLoading: false, isConnected: true, error: '', saveProfile: wallet.save, clearWallet: wallet.clear })
  wallet.save.mockResolvedValue(profile)
  wallet.clear.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('profile save and identity feedback', () => {
  it('does not report a failed profile save as successful', async () => {
    wallet.save.mockResolvedValue(null)
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
    expect(screen.queryByText(/Profile saved/)).toBeNull()
  })
  it('initializes linked fields from the profile and reports confirmed saves', async () => {
    render(<ProfilePage />)
    expect(screen.getByLabelText('Display name')).toHaveValue('Alex')
    expect(screen.getByLabelText('Bio')).toHaveValue('Public writing')
    expect(screen.getByText('Public app identity')).toBeTruthy()
    expect(screen.queryByText('ZCASH ADDRESS')).toBeNull()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Alex Updated ' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(await screen.findByText('Profile saved.')).toBeTruthy()
    expect(wallet.save).toHaveBeenCalledWith({ displayName: 'Alex Updated', bio: 'Public writing', skills: ['Writing'] })
  })
  it('shows clipboard and disconnect errors without pretending either action succeeded', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
    wallet.clear.mockRejectedValue(new Error('Connection could not be ended.'))
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy public app identity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Clipboard unavailable/)
    fireEvent.click(screen.getByRole('button', { name: /Disconnect wallet/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connection could not be ended.'))
    expect(wallet.push).not.toHaveBeenCalled()
  })
})

describe('session-scoped notification feedback', () => {
  it('shows a failed load with retry and uses no client-supplied identity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Notifications are unavailable.' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ notifications: [note] }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications are unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(note.title)).toBeTruthy()
    expect(fetcher.mock.calls[0][0]).toBe('/api/notifications')
  })
  it('keeps unread state and stays on the page when marking a notification fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ error: 'Could not mark this update read.' }, { status: 503 })
      : Response.json({ notifications: [note] })))
    render(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Unread.*Work ready/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not mark this update read.')
    expect(screen.getByText('1 unread')).toBeTruthy()
    expect(wallet.push).not.toHaveBeenCalled()
  })
  it('marks only after server success and rejects an unsafe notification destination', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ ok: true }) : Response.json({ notifications: [{ ...note, link: 'javascript:alert(1)' }] }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Unread.*Work ready/i }))
    expect(await screen.findByText('All caught up')).toBeTruthy()
    expect(wallet.push).not.toHaveBeenCalled()
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ id: 'note1' })
  })
  it('marks all read with the server session and reports an empty list clearly', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ ok: true }) : Response.json({ notifications: [note] }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    expect(await screen.findByText('All caught up')).toBeTruthy()
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ all: true })
  })
})
