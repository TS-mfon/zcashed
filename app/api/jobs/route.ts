import { NextRequest, NextResponse } from 'next/server'
import { getAllJobs, getJobsByClient, getJobsByWorker } from '@/lib/store'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'
import { createJobFromIntent, creationKey } from '@/lib/job-creation'
import { JOB_CATEGORIES, type Job } from '@/lib/types'

export const maxDuration = 180
const MAX_ZATOSHIS = 21_000_000 * 100_000_000

export async function GET(req: NextRequest) {
  try {
    const address = new URL(req.url).searchParams.get('address')
    if (address) {
      requireActor(req, address)
      const [posted, working] = await Promise.all([getJobsByClient(address), getJobsByWorker(address)])
      return NextResponse.json({ posted, working })
    }
    return NextResponse.json({ jobs: await getAllJobs() })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid job body')
    if (body.clientAddress !== undefined && typeof body.clientAddress !== 'string') throw new ApiError(400, 'Invalid client identity')
    const clientAddress = requireActor(req, body.clientAddress)
    const offer = jobInput(body)
    const key = creationKey(body.creationId, req.headers.get('idempotency-key'))
    const job = await createJobFromIntent(clientAddress, key, offer)
    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

function jobInput(body: Record<string, unknown>) {
  const title = boundedText(body.title, 'Title', 1, 200)
  const description = boundedText(body.description, 'Public requirements', 20, 12000)
  if (description.split('\n').filter((line) => line.trim()).length > 12) throw new ApiError(400, 'Use one to twelve public rubric lines')
  const budgetZatoshis = body.budgetZatoshis
  if (typeof budgetZatoshis !== 'number' || !Number.isSafeInteger(budgetZatoshis) ||
      budgetZatoshis <= 0 || budgetZatoshis > MAX_ZATOSHIS) throw new ApiError(400, 'Valid budget in integer zatoshis required')
  const category = body.category ?? 'Other'
  if (typeof category !== 'string' || !JOB_CATEGORIES.includes(category as typeof JOB_CATEGORIES[number])) throw new ApiError(400, 'Invalid category')
  const assignmentMode = body.assignmentMode ?? 'application'
  if (assignmentMode !== 'direct' && assignmentMode !== 'application') throw new ApiError(400, 'Invalid assignment mode')
  let deadline: string | null = null
  if (body.deadline !== undefined && body.deadline !== null && body.deadline !== '') {
    if (typeof body.deadline !== 'string' || !Number.isFinite(Date.parse(body.deadline))) throw new ApiError(400, 'Invalid deadline')
    deadline = new Date(body.deadline).toISOString()
  }
  return { title, description, budgetZatoshis, budgetZec: budgetZatoshis / 100_000_000,
    category, assignmentMode: assignmentMode as Job['assignmentMode'], deadline }
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) {
    throw new ApiError(400, label + ' must contain ' + minimum + '-' + maximum + ' characters')
  }
  return value.trim()
}
