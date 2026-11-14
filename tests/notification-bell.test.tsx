// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell } from '../components/NotificationBell'

const account = vi.hoisted(() => ({ push: vi.fn(), wallet: vi.fn() }))
vi.mock('../components/WalletContext', () => ({ useWallet: account.wallet }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: account.push }) }))

const note = { id: 'bell-note', recipientAddress: 'user_' + '1'.repeat(64), type: 'welcome',
  title: 'Private wallet connected', body: 'Review your profile.', link: '/profile', read: false, createdAt: '2026-11-14T00:00:00Z' }

beforeEach(() => { vi.resetAllMocks(); account.wallet.mockReturnValue({ address: note.recipientAddress }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('notification bell uses the authenticated session', () => {
  it('loads and marks all read without sending a client-supplied identity', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ ok: true }) : Response.json({ notifications: [note], unread: 1 }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull())
    expect(fetcher.mock.calls[0][0]).toBe('/api/notifications')
    const post = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ all: true })
  })

  it('shows load errors with a retry and keeps unread state when a mark request fails', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ error: 'The update could not be saved.' }, { status: 503 })
      : Response.json({ notifications: [note], unread: 1 }))
      .mockResolvedValueOnce(Response.json({ error: 'Notifications unavailable.' }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The update could not be saved.')
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeTruthy()
  })

  it('does not navigate after a failed mark or to an unsafe destination', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? Response.json({ ok: true }) : Response.json({ notifications: [{ ...note, link: 'javascript:alert(1)' }], unread: 1 }))
    vi.stubGlobal('fetch', fetcher)
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(await screen.findByRole('button', { name: /Private wallet connected/ }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    expect(account.push).not.toHaveBeenCalled()
  })
})
