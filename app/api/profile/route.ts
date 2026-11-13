import { NextRequest, NextResponse } from 'next/server'
import { getProfile, upsertProfile } from '@/lib/store'
import { notify } from '@/lib/notify'
import { Profile, Role } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ profile: null })
  const profile = await getProfile(address)
  return NextResponse.json({ profile })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { address, displayName, role, bio, skills } = body
    if (!address) return NextResponse.json({ error: 'Address required' }, { status: 400 })

    const existing = await getProfile(address)
    const isNew = !existing

    const profile: Profile = {
      address,
      displayName: displayName ?? existing?.displayName ?? '',
      role: (role as Role) ?? existing?.role ?? 'freelancer',
      bio: bio ?? existing?.bio ?? '',
      skills: Array.isArray(skills) ? skills : existing?.skills ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }

    await upsertProfile(profile)

    if (isNew) {
      await notify({
        to: address,
        type: 'welcome',
        title: 'Welcome to ZCashed! 👋',
        body:
          profile.role === 'client'
            ? 'Post your first job and let AI-judged escrow handle the rest.'
            : 'Browse jobs and start earning private ZEC payments.',
        link: profile.role === 'client' ? '/jobs/new' : '/jobs',
      })
    }

    return NextResponse.json({ profile })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
