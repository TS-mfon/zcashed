import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob } from '@/lib/store'
import { notify } from '@/lib/notify'

// Direct-mode: a freelancer self-accepts an open job.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { workerAddress } = await req.json()
    if (!workerAddress) return NextResponse.json({ error: 'Worker address required' }, { status: 400 })

    const job = await getJob(id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.assignmentMode !== 'direct')
      return NextResponse.json({ error: 'This job requires an application' }, { status: 400 })
    if (job.status !== 'open') return NextResponse.json({ error: 'Job is not open' }, { status: 400 })
    if (job.clientAddress === workerAddress)
      return NextResponse.json({ error: 'Cannot accept your own job' }, { status: 400 })

    const updated = await updateJob(id, { workerAddress, status: 'in_progress' })

    await notify({
      to: job.clientAddress,
      type: 'job_assigned',
      title: 'Your job was accepted',
      body: `${workerAddress.slice(0, 10)}… accepted "${job.title}" and started working.`,
      link: `/jobs/${id}`,
    })

    if (job.genlayerContractAddress) {
      import('@/lib/genlayer')
        .then(({ acceptJobOnChain }) => acceptJobOnChain(job.genlayerContractAddress, workerAddress))
        .catch(console.error)
    }

    return NextResponse.json({ job: updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
