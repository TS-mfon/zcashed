import { NextRequest, NextResponse } from 'next/server'
import { getAllJobs, createJob, getJobsByClient, getJobsByWorker } from '@/lib/store'
import { generateZcashTestnetAddress } from '@/lib/zcash'
import { generateId } from '@/lib/utils'
import { Job } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')

  if (address) {
    const [posted, working] = await Promise.all([
      getJobsByClient(address),
      getJobsByWorker(address),
    ])
    return NextResponse.json({ posted, working })
  }

  const jobs = await getAllJobs()
  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      title,
      description,
      category,
      budgetZec,
      deadline,
      clientAddress,
      assignmentMode,
    } = body

    if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    if (!clientAddress) return NextResponse.json({ error: 'Client address is required' }, { status: 400 })
    if (!budgetZec || budgetZec <= 0) return NextResponse.json({ error: 'Valid budget required' }, { status: 400 })

    const escrow = await generateZcashTestnetAddress()

    const job: Job = {
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      category: category ?? 'Other',
      budgetZec: parseFloat(budgetZec),
      assignmentMode: assignmentMode === 'direct' ? 'direct' : 'application',
      clientAddress,
      escrowAddress: escrow.address,
      escrowPrivKey: escrow.privateKeyHex,
      workerAddress: '',
      status: 'open',
      genlayerContractAddress: '',
      deadline: deadline || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submissions: [],
      applications: [],
    }

    deployContractAsync(job)
    await createJob(job)
    return NextResponse.json({ job })
  } catch (err: any) {
    console.error('POST /api/jobs error:', err)
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 })
  }
}

async function deployContractAsync(job: Job) {
  try {
    const { deployEscrowContract } = await import('@/lib/genlayer')
    const { updateJob } = await import('@/lib/store')
    const contractAddress = await deployEscrowContract({
      taskTitle: job.title,
      taskDescription: job.description,
      budgetZec: job.budgetZec.toString(),
      clientAddress: job.clientAddress,
      escrowZcashAddress: job.escrowAddress,
    })
    await updateJob(job.id, { genlayerContractAddress: contractAddress })
    console.log(`GenLayer contract deployed for job ${job.id}: ${contractAddress}`)
  } catch (err) {
    console.error(`Failed to deploy GenLayer contract for job ${job.id}:`, err)
  }
}
