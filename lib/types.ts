export type Role = 'freelancer' | 'client' | 'admin'

export type AssignmentMode = 'direct' | 'application'

export type JobStatus =
  | 'open'
  | 'in_progress'
  | 'under_review'
  | 'needs_revision'
  | 'approved'
  | 'completed'
  | 'cancelled'

export type SubmissionStatus = 'pending' | 'reviewing' | 'approved' | 'rejected'

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected'

export type NotificationType =
  | 'application_received'
  | 'application_accepted'
  | 'application_rejected'
  | 'job_assigned'
  | 'work_submitted'
  | 'work_approved'
  | 'work_rejected'
  | 'payment_released'
  | 'job_completed'
  | 'welcome'

export interface Profile {
  address: string
  displayName: string
  role: Role
  bio: string
  skills: string[]
  createdAt: string
}

export interface Job {
  id: string
  title: string
  description: string
  category: string
  budgetZec: number
  assignmentMode: AssignmentMode
  clientAddress: string
  escrowAddress: string
  escrowPrivKey: string
  workerAddress: string
  status: JobStatus
  genlayerContractAddress: string
  deadline: string | null
  createdAt: string
  updatedAt: string
  submissions: Submission[]
  applications: Application[]
}

export interface Application {
  id: string
  jobId: string
  applicantAddress: string
  applicantName: string
  coverLetter: string
  proposedPrice: number
  status: ApplicationStatus
  createdAt: string
}

export interface Submission {
  id: string
  jobId: string
  workerAddress: string
  submissionUrl: string
  notes: string
  status: SubmissionStatus
  aiFeedback: string
  attempt: number
  genlayerTxHash: string
  createdAt: string
}

export interface Notification {
  id: string
  recipientAddress: string
  type: NotificationType
  title: string
  body: string
  link: string
  read: boolean
  createdAt: string
}

export type JobCategory =
  | 'Development'
  | 'Design'
  | 'Writing'
  | 'Marketing'
  | 'Research'
  | 'Data'
  | 'Security'
  | 'Other'

export const JOB_CATEGORIES: JobCategory[] = [
  'Development',
  'Design',
  'Writing',
  'Marketing',
  'Research',
  'Data',
  'Security',
  'Other',
]
