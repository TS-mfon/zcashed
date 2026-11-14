import { NextRequest, NextResponse } from 'next/server'
import { getProfile, upsertProfile } from '@/lib/store'
import { notify } from '@/lib/notify'
import { ApiError, apiErrorResponse, getSession, requireActor } from '@/lib/auth'
import type { Profile } from '@/lib/types'

export async function GET(req: NextRequest) {
  try {
    const actor = requireActor(req, undefined, true)
    const profile = await getProfile(actor)
    const username = getSession(req)?.username
    return NextResponse.json({ profile: profile ? { ...profile, ...(username ? { username } : {}) } : null }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiErrorResponse(error) }
}

export async function POST(req: NextRequest) {
  try {
    const actor = requireActor(req)
    const username = getSession(req)!.username!
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['displayName', 'role', 'bio', 'skills'].includes(key))) throw new ApiError(400, 'Supply only profile fields; your signed-in username identifies the account.')
    const fields = body as Record<string, unknown>
    if (fields.role !== undefined && fields.role !== 'client' && fields.role !== 'freelancer') throw new ApiError(400, 'Choose client or freelancer.')
    for (const [key, maximum] of [['displayName', 80], ['bio', 2000]] as const) {
      if (fields[key] !== undefined && (typeof fields[key] !== 'string' || (fields[key] as string).length > maximum)) throw new ApiError(400, 'Invalid ' + key + '.')
    }
    if (fields.skills !== undefined && (!Array.isArray(fields.skills) || fields.skills.length > 20 || fields.skills.some(value => typeof value !== 'string' || value.length > 60))) throw new ApiError(400, 'Use up to 20 short skill names.')
    const existing = await getProfile(actor)
    const profile: Profile = {
      address: actor,
      username,
      displayName: fields.displayName as string ?? existing?.displayName ?? username,
      role: fields.role as 'client' | 'freelancer' ?? existing?.role ?? 'freelancer',
      bio: fields.bio as string ?? existing?.bio ?? '',
      skills: fields.skills as string[] ?? existing?.skills ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    await upsertProfile(profile)
    if (!existing) await notify({to: actor, type: 'welcome', title: 'Welcome to ZCashed', body: profile.role === 'client' ? 'Post a job, fund its testnet vault, and choose a worker.' : 'Browse jobs and submit work for GenLayer review.', link: profile.role === 'client' ? '/jobs/new' : '/jobs'}).catch(() => console.error('Welcome notification unavailable'))
    return NextResponse.json({ profile })
  } catch (error) { return apiErrorResponse(error) }
}
