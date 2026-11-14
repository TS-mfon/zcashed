import { NextRequest, NextResponse } from 'next/server'
import { getJob, addApplication, getProfile } from '@/lib/store'
import { notify } from '@/lib/notify'
import { generateId } from '@/lib/utils'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import type { Application } from '@/lib/types'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid application.')
    const fields = body as Record<string, unknown>
    const actor = requireActor(req, fields.applicantAddress)
    if (Object.keys(fields).some(key => !['applicantAddress', 'coverLetter', 'proposedPrice'].includes(key))) throw new ApiError(400, 'Invalid application fields.')
    if (fields.coverLetter !== undefined && (typeof fields.coverLetter !== 'string' || fields.coverLetter.length > 5000)) throw new ApiError(400, 'Use a cover letter under 5000 characters.')
    const { id } = await params
    const job = await getJob(id)
    if (!job) throw new ApiError(404, 'Job not found')
    if (job.assignmentMode !== 'application' || job.status !== 'open') throw new ApiError(400, 'This job is not accepting applications.')
    if (job.clientAddress === actor) throw new ApiError(400, 'Cannot apply to your own job.')
    if (job.applications.some(application => application.applicantAddress === actor)) throw new ApiError(409, 'You already applied to this job.')
    const price = fields.proposedPrice === undefined || fields.proposedPrice === '' ? job.budgetZec : Number(fields.proposedPrice)
    if (!['undefined', 'number', 'string'].includes(typeof fields.proposedPrice) || !Number.isFinite(price) || price <= 0 || price > 21_000_000) throw new ApiError(400, 'Use a positive ZEC proposed price.')
    if (price !== job.budgetZec) throw new ApiError(400, 'This job pays its fixed funded budget; negotiated bids are not supported.')
    const profile = await getProfile(actor)
    const application: Application = {id: generateId(), jobId: id, applicantAddress: actor, applicantName: profile?.displayName || '', coverLetter: fields.coverLetter as string ?? '', proposedPrice: price, status: 'pending', createdAt: new Date().toISOString()}
    await addApplication(application)
    await notify({to: job.clientAddress, type: 'application_received', title: 'New application received', body: (application.applicantName || 'A freelancer') + ' applied to "' + job.title + '".', link: '/jobs/' + id}).catch(() => console.error('Application notification unavailable'))
    return NextResponse.json({ application })
  } catch (error) { return apiErrorResponse(error) }
}
