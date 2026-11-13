import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob, updateApplication } from '@/lib/store'
import { notify } from '@/lib/notify'

// Application-mode: client picks an applicant and assigns the job.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { applicationId, clientAddress } = await req.json()

    const job = await getJob(id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (clientAddress && job.clientAddress !== clientAddress)
      return NextResponse.json({ error: 'Only the client can assign this job' }, { status: 403 })
    if (job.status !== 'open') return NextResponse.json({ error: 'Job is not open' }, { status: 400 })

    const chosen = (job.applications ?? []).find((a) => a.id === applicationId)
    if (!chosen) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

    // Accept chosen, reject the rest
    await updateApplication(id, chosen.id, { status: 'accepted' })
    for (const app of job.applications ?? []) {
      if (app.id !== chosen.id) {
        await updateApplication(id, app.id, { status: 'rejected' })
        await notify({
          to: app.applicantAddress,
          type: 'application_rejected',
          title: 'Application not selected',
          body: `Your application for "${job.title}" was not selected this time.`,
          link: `/jobs/${id}`,
        })
      }
    }

    const updated = await updateJob(id, {
      workerAddress: chosen.applicantAddress,
      status: 'in_progress',
    })

    await notify({
      to: chosen.applicantAddress,
      type: 'application_accepted',
      title: "You've been hired! 🎉",
      body: `You were selected for "${job.title}". Start working and submit when ready.`,
      link: `/jobs/${id}`,
    })

    if (job.genlayerContractAddress) {
      import('@/lib/genlayer')
        .then(({ acceptJobOnChain }) =>
          acceptJobOnChain(job.genlayerContractAddress, chosen.applicantAddress),
        )
        .catch(console.error)
    }

    return NextResponse.json({ job: updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
