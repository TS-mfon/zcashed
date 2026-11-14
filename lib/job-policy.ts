export const TEXT_REVIEW_POLICY = 'public-text-v1' as const
export const SUPPORTED_JOB_CATEGORIES = ['Writing', 'Marketing'] as const
export const TEXT_DELIVERABLE_KINDS = ['article', 'copy', 'translation', 'editing', 'summary'] as const
export type TextDeliverableKind = typeof TEXT_DELIVERABLE_KINDS[number]

export const TEXT_DELIVERABLE_LABELS: Record<TextDeliverableKind, string> = {
  article: 'Article or blog post', copy: 'Marketing copy', translation: 'Translation',
  editing: 'Editing or rewriting', summary: 'Summary of supplied text',
}
export const TEXT_JOB_SCOPE = 'Only articles, marketing copy, translations, edits, and summaries that can be reviewed entirely from pasted text are supported.'

type TextOffer = { title: string; description: string; category: string; deliverableKind?: unknown; reviewPolicy?: unknown }
export class JobPolicyError extends Error { readonly status = 400 }

// These guards reject obvious unsupported offers before any deployment. The
// intelligent contract independently assesses the full rubric's admissibility.
const UNSUPPORTED_TASK = /(?:^|[.;:\n]\s*|\b(?:must|should|need to|required to|please)\s+)(?:build|develop|deploy|implement|program|code|design|create|deliver|submit|provide|produce|record|film|draw|photograph|upload)\b[^.\n]{0,70}\b(?:website|web app|application|smart contract|software|codebase|repository|repo|logo|image|illustration|graphic|screenshot|video|audio|animation|attachment|pdf|spreadsheet|presentation|file|figma|prototype)\b/i
const CODE_DELIVERABLE = /\b(?:write|create|implement|code|build|develop)\s+(?:(?:a|an|the|working|complete|simple)\s+)*(?:(?:python|typescript|javascript|rust|solidity|java|c\+\+)\s+)?(?:function|script|program|api|contract|code|app)\b/i
const UNSUPPORTED_VERIFICATION = /\b(?:run|execute|pass|passing)\s+(?:the\s+|all\s+|automated\s+|unit\s+|integration\s+|e2e\s+)*(?:tests?|code|program|software)\b|\b(?:visit|fetch|open|inspect|audit|verify|check)\b[^.\n]{0,50}\b(?:website|repository|repo|webpage|url|link|live|sources?|facts?|citations?|external|current|real[- ]time)\b|\b(?:working|functional|deployed|responsive|interactive)\s+(?:website|app|application|prototype)\b|\b(?:plagiarism[- ]free|fact[- ]checked|copyright[- ]free)\b|\b(?:prove|verify|guarantee)\b[^.\n]{0,40}\b(?:authorship|originality)\b/i

export function validateTextJob(offer: TextOffer): string | null {
  if (!(SUPPORTED_JOB_CATEGORIES as readonly string[]).includes(offer.category)) return TEXT_JOB_SCOPE
  if (offer.deliverableKind !== undefined && !(TEXT_DELIVERABLE_KINDS as readonly unknown[]).includes(offer.deliverableKind)) return 'Choose a supported text deliverable.'
  const content = `${offer.title}\n${offer.description}`
  if (/https?:\/\/|www\./i.test(content)) return 'Paste any source text into the requirements. Website links and external verification are not supported.'
  if (UNSUPPORTED_TASK.test(content) || CODE_DELIVERABLE.test(content) || UNSUPPORTED_VERIFICATION.test(content)) return 'This job requires artifacts or verification outside pasted text. Choose a writing or marketing text deliverable and remove those requirements.'
  return null
}

export function assertSupportedJob(offer: TextOffer): void {
  if (offer.reviewPolicy !== undefined && offer.reviewPolicy !== TEXT_REVIEW_POLICY) throw new JobPolicyError('This job uses an unsupported review policy.')
  const error = validateTextJob(offer)
  if (error) throw new JobPolicyError(error)
}

export function validateTextSubmission(text: string, submissionUrl?: unknown): string | null {
  if (submissionUrl !== undefined && submissionUrl !== '') return 'Submit the complete deliverable as pasted text. Deliverable URLs and attachments are disabled.'
  if (typeof text !== 'string' || text.trim().length < 20 || text.trim().length > 12000) return 'Paste the complete public text deliverable (20–12000 characters).'
  return null
}
