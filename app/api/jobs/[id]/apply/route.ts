import { NextRequest, NextResponse } from 'next/server'
import { getJob, addApplication, getProfile } from '@/lib/store'
import { notify } from '@/lib/notify'
import { generateId } from '@/lib/utils'
import { Application } from '@/lib/types'

// Application-mode: a freelancer applies to a job.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { applicantAddress, coverLetter, proposedPrice } = await req.json()
    if (!applicantAddress) return NextResponse.json({ error: 'Applicant address required' }, { status: 400 })

    const job = await getJob(id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.assignmentMode !== 'application')
      return NextResponse.json({ error: 'This job is direct-assignment only' }, { status: 400 })
    if (job.status !== 'open') return NextResponse.json({ error: 'Job is no longer open' }, { status: 400 })
    if (job.clientAddress === applicantAddress)
      return NextResponse.json({ error: 'Cannot apply to your own job' }, { status: 400 })
    if ((job.applications ?? []).some((a) => a.applicantAddress === applicantAddress))
      return NextResponse.json({ error: 'You already applied to this job' }, { status: 400 })

    const profile = await getProfile(applicantAddress)

    const application: Application = {
      id: generateId(),
      jobId: id,
      applicantAddress,
      applicantName: profile?.displayName || '',
      coverLetter: coverLetter ?? '',
      proposedPrice: proposedPrice ? parseFloat(proposedPrice) : job.budgetZec,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    await addApplication(application)

    await notify({
      to: job.clientAddress,
      type: 'application_received',
      title: 'New application received',
      body: `${application.applicantName || applicantAddress.slice(0, 10) + '…'} applied to "${job.title}".`,
      link: `/jobs/${id}`,
    })

    return NextResponse.json({ application })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
