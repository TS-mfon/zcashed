import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const fake = vi.hoisted(() => ({ getProfile: vi.fn(), upsertProfile: vi.fn(), notify: vi.fn(), actor: 'user_owner' }))
vi.mock('@/lib/store', () => fake)
vi.mock('@/lib/notify', () => ({notify: fake.notify}))
vi.mock('@/lib/auth', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  return {ApiError, requireActor: () => fake.actor, apiErrorResponse: (e: unknown) => NextResponse.json({error: 'Rejected'}, {status: e instanceof ApiError ? e.status : 500})}
})
import { GET, POST } from '../app/api/profile/route'
const request = (body: unknown) => new NextRequest('http://localhost/api/profile', {method:'POST', body: JSON.stringify(body)})
beforeEach(() => {vi.clearAllMocks(); fake.getProfile.mockResolvedValue(null); fake.notify.mockResolvedValue(undefined)})
it('onboards the authenticated wallet without request address', async () => {
  const r = await POST(request({displayName: 'Ada', role: 'client', bio: '', skills: []}))
  expect(r.status).toBe(200); expect(fake.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({address: fake.actor, role: 'client'}))
})
it('reads the signed-in profile without request address', async () => {
  await GET(new NextRequest('http://localhost/api/profile')); expect(fake.getProfile).toHaveBeenCalledWith(fake.actor)
})
it.each([{role:'admin'}, {address:'user_victim'}, {displayName:5}, {skills:['ok', 1]}, {bio:'x'.repeat(2001)}])('rejects dangerous profile changes %j', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(fake.upsertProfile).not.toHaveBeenCalled()
})
