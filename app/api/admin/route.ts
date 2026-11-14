import { NextRequest, NextResponse } from 'next/server'
import { getAllJobs, getAllProfiles, storageBackend } from '@/lib/store'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
  const actor = requireActor(req)
  if (!(process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).includes(actor)) throw new ApiError(403, 'Administrator access is not authorized for this session.')
  const [jobs, profiles] = await Promise.all([getAllJobs(), getAllProfiles()])

  const totalVolume = jobs
    .filter((j) => j.status === 'completed')
    .reduce((sum, j) => sum + j.budgetZec, 0)
  const escrowLocked = jobs
    .filter((j) => ['open', 'in_progress', 'under_review', 'needs_revision', 'approved'].includes(j.status))
    .reduce((sum, j) => sum + j.budgetZec, 0)

  return NextResponse.json({
    jobs,
    profiles,
    stats: {
      totalJobs: jobs.length,
      openJobs: jobs.filter((j) => j.status === 'open').length,
      completedJobs: jobs.filter((j) => j.status === 'completed').length,
      inProgressJobs: jobs.filter((j) =>
        ['in_progress', 'under_review', 'needs_revision', 'approved'].includes(j.status),
      ).length,
      totalUsers: profiles.length,
      freelancers: profiles.filter((p) => p.role === 'freelancer').length,
      clients: profiles.filter((p) => p.role === 'client').length,
      totalVolume,
      escrowLocked,
      backend: storageBackend(),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiErrorResponse(error) }
}
