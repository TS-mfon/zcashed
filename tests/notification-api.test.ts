import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const fake = vi.hoisted(() => ({ getNotifications: vi.fn(), markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn(), actor: 'user_owner' }))
vi.mock('@/lib/store', () => fake)
vi.mock('@/lib/auth', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  return { ApiError, requireActor: () => fake.actor, apiErrorResponse: (e: unknown) => NextResponse.json({error: 'Rejected'}, {status: e instanceof ApiError ? e.status : 500}) }
})
import { GET, POST } from '../app/api/notifications/route'
beforeEach(() => { vi.clearAllMocks(); fake.getNotifications.mockResolvedValue([{id: 'n1', read: false}]) })
it('lists only session notifications without requiring an address', async () => {
  const r = await GET(new NextRequest('http://localhost/api/notifications'))
  expect(r.status).toBe(200); expect(fake.getNotifications).toHaveBeenCalledWith(fake.actor)
  expect(await r.json()).toMatchObject({unread: 1})
})
it('marks a notification with the verified actor', async () => {
  const r = await POST(new NextRequest('http://localhost/api/notifications', {method: 'POST', body: JSON.stringify({id: 'n1'})}))
  expect(r.status).toBe(200); expect(fake.markNotificationRead).toHaveBeenCalledWith('n1', fake.actor)
})
it('rejects arbitrary request fields and cannot mark another user notifications', async () => {
  const r = await POST(new NextRequest('http://localhost/api/notifications', {method: 'POST', body: JSON.stringify({all: true, address: 'user_victim'})}))
  expect(r.status).toBe(400); expect(fake.markAllNotificationsRead).not.toHaveBeenCalled()
})
