import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const fake = vi.hoisted(() => ({getJob: vi.fn(), addApplication: vi.fn(), getProfile: vi.fn(), getApplicationsByApplicant: vi.fn(), notify: vi.fn(), actor: 'user_worker'}))
vi.mock('@/lib/store', () => fake)
vi.mock('@/lib/notify', () => ({notify: fake.notify}))
vi.mock('@/lib/auth', () => {
 class ApiError extends Error {constructor(public status: number, message: string) {super(message)}}
 return {ApiError, requireActor: (_r: unknown, claimed?: unknown) => {if(claimed !== undefined && claimed !== fake.actor) throw new ApiError(403, 'Forbidden'); return fake.actor}, apiErrorResponse: (e: unknown) => NextResponse.json({error:'Rejected'},{status:e instanceof ApiError ? e.status : 500})}
})
import { POST } from '../app/api/jobs/[id]/apply/route'
import { GET } from '../app/api/applications/route'
const context = {params: Promise.resolve({id:'job1'})}
const request = (body: unknown) => new NextRequest('http://localhost/api/jobs/job1/apply',{method:'POST',body:JSON.stringify(body)})
beforeEach(() => {vi.clearAllMocks(); fake.getJob.mockResolvedValue({id:'job1',clientAddress:'user_client',assignmentMode:'application',status:'open',budgetZec:0.1,applications:[]}); fake.getProfile.mockResolvedValue(null); fake.notify.mockResolvedValue(undefined)})
it('applies with the signed-in worker and no supplied address', async () => {expect((await POST(request({coverLetter:'I can do this task.'}), context)).status).toBe(200); expect(fake.addApplication).toHaveBeenCalledWith(expect.objectContaining({applicantAddress:fake.actor,proposedPrice:0.1}))})
it('rejects a forged applicant', async () => {expect((await POST(request({applicantAddress:'user_victim'}),context)).status).toBe(403); expect(fake.addApplication).not.toHaveBeenCalled()})
it.each([{proposedPrice:-1},{proposedPrice:'NaN'},{coverLetter:123}])('rejects invalid application %j', async body => {expect((await POST(request(body),context)).status).toBe(400); expect(fake.addApplication).not.toHaveBeenCalled()})
it('lists the current worker applications only', async () => {fake.getApplicationsByApplicant.mockResolvedValue([]); await GET(new NextRequest('http://localhost/api/applications')); expect(fake.getApplicationsByApplicant).toHaveBeenCalledWith(fake.actor)})
