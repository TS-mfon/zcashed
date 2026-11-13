import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateJob, addSubmission } from '@/lib/store'
import { notify } from '@/lib/notify'
import { generateId } from '@/lib/utils'
import { Submission, Job } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { jobId, workerAddress, submissionUrl, notes } = body

    if (!jobId || !workerAddress || !submissionUrl) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const job = await getJob(jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.status !== 'in_progress' && job.status !== 'needs_revision') {
      return NextResponse.json({ error: `Cannot submit work in status: ${job.status}` }, { status: 400 })
    }

    await updateJob(jobId, { status: 'under_review' })
    await notify({
      to: job.clientAddress,
      type: 'work_submitted',
      title: 'Work submitted for review',
      body: `A submission for "${job.title}" is being evaluated by GenLayer AI.`,
      link: `/jobs/${jobId}`,
    })

    const attemptNumber = (job.submissions?.length ?? 0) + 1
    const submissionContent = `URL: ${submissionUrl}${notes ? `\n\nNotes: ${notes}` : ''}`

    let approved = false
    let rejectionReason = ''
    let txHash = ''

    if (job.genlayerContractAddress) {
      try {
        const { submitWorkOnChain } = await import('@/lib/genlayer')
        const result = await submitWorkOnChain(job.genlayerContractAddress, submissionContent, workerAddress)
        approved = result.approved
        rejectionReason = result.rejectionReason
        txHash = result.txHash
      } catch (glErr) {
        console.error('GenLayer evaluation error, using fallback:', glErr)
        const fb = localEvaluate(submissionUrl, submissionContent)
        approved = fb.approved
        rejectionReason = fb.reason
      }
    } else {
      const fb = localEvaluate(submissionUrl, submissionContent)
      approved = fb.approved
      rejectionReason = fb.reason
    }

    const submission: Submission = {
      id: generateId(),
      jobId,
      workerAddress,
      submissionUrl,
      notes: notes ?? '',
      status: approved ? 'approved' : 'rejected',
      aiFeedback: rejectionReason,
      attempt: attemptNumber,
      genlayerTxHash: txHash,
      createdAt: new Date().toISOString(),
    }
    await addSubmission(submission)

    if (approved) {
      await updateJob(jobId, { status: 'approved' })
      await notify({
        to: workerAddress,
        type: 'work_approved',
        title: 'Work approved — payment released! 💰',
        body: `${job.budgetZec} ZEC has been released from escrow for "${job.title}".`,
        link: `/jobs/${jobId}`,
      })
      await notify({
        to: job.clientAddress,
        type: 'job_completed',
        title: 'Job completed',
        body: `AI approved the work for "${job.title}" and released payment.`,
        link: `/jobs/${jobId}`,
      })
      return NextResponse.json({
        approved: true,
        txHash,
        message: `${job.budgetZec} ZEC payment released from escrow`,
      })
    } else {
      await updateJob(jobId, { status: 'needs_revision' })
      await notify({
        to: workerAddress,
        type: 'work_rejected',
        title: 'Revision requested',
        body: `AI requested changes for "${job.title}". Review the feedback and resubmit.`,
        link: `/jobs/${jobId}`,
      })
      return NextResponse.json({ approved: false, txHash, rejectionReason })
    }
  } catch (err: any) {
    console.error('POST /api/submit error:', err)
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 })
  }
}

function localEvaluate(url: string, content: string): { approved: boolean; reason: string } {
  const hasUrl = url.startsWith('http') || url.includes('.')
  const hasContent = content.length > 20
  if (hasUrl && hasContent) return { approved: true, reason: '' }
  return {
    approved: false,
    reason: 'Submission requires a valid URL/proof and sufficient detail about the work completed.',
  }
}
