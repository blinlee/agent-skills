import { readFile } from 'node:fs/promises'
import type { NormalizedArtifact } from '../types.js'

export type InboxQualityStatus = 'ready' | 'needs_review'

export type InboxQualityDecision = 'accept' | 'reject' | 'park' | 'convert' | 'merge'

export type InboxKnowledgeValue = 'high' | 'medium' | 'low' | 'none'

export type InboxReadability = 'readable' | 'needs_decode' | 'unreadable'

export type InboxDuplicateStatus = 'new' | 'duplicate' | 'possible_duplicate' | 'unknown'

export type InboxQualityEvidence = {
  quote: string
  note?: string
}

export type InboxQualityPlan = {
  schema: 'llm-wiki.inbox-quality.v1'
  status: InboxQualityStatus
  decision: InboxQualityDecision
  recommendedAction?: InboxQualityDecision
  knowledgeValue: InboxKnowledgeValue
  readability: InboxReadability
  duplicateAssessment: {
    status: InboxDuplicateStatus
    matchedRefs: string[]
  }
  sourceType: string
  reason: string
  evidence: InboxQualityEvidence[]
  blockers?: string[]
}

export type ValidatedInboxQualityPlan = InboxQualityPlan & {
  recommendedAction: InboxQualityDecision
  blockers: string[]
}

export async function loadInboxQualityPlan(filePath: string): Promise<InboxQualityPlan> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  return normalizeInboxQualityPlan(parsed)
}

export function normalizeInboxQualityPlan(value: unknown): InboxQualityPlan {
  if (!isRecord(value)) {
    throw new Error('inbox quality plan must be a JSON object')
  }
  if (value.schema !== 'llm-wiki.inbox-quality.v1') {
    throw new Error('inbox quality plan schema must be llm-wiki.inbox-quality.v1')
  }

  const decision = enumValue(value.decision, ['accept', 'reject', 'park', 'convert', 'merge'], 'decision')
  const duplicateAssessment = normalizeDuplicateAssessment(value.duplicateAssessment)

  return {
    schema: 'llm-wiki.inbox-quality.v1',
    status: enumValue(value.status, ['ready', 'needs_review'], 'status'),
    decision,
    recommendedAction: optionalEnumValue(value.recommendedAction, ['accept', 'reject', 'park', 'convert', 'merge'], 'recommendedAction'),
    knowledgeValue: enumValue(value.knowledgeValue, ['high', 'medium', 'low', 'none'], 'knowledgeValue'),
    readability: enumValue(value.readability, ['readable', 'needs_decode', 'unreadable'], 'readability'),
    duplicateAssessment,
    sourceType: requiredString(value.sourceType, 'sourceType'),
    reason: requiredString(value.reason, 'reason'),
    evidence: normalizeEvidence(value.evidence),
    blockers: normalizeStringArray(value.blockers, 'blockers'),
  }
}

export function validateInboxQualityPlan(input: {
  artifact: NormalizedArtifact
  plan: InboxQualityPlan
}): ValidatedInboxQualityPlan {
  const plan: ValidatedInboxQualityPlan = {
    ...input.plan,
    recommendedAction: input.plan.recommendedAction ?? input.plan.decision,
    blockers: input.plan.blockers ?? [],
  }
  const errors: string[] = []

  if (plan.recommendedAction !== plan.decision) {
    errors.push('recommendedAction must match decision')
  }
  if (!plan.reason.trim()) {
    errors.push('reason must not be empty')
  }
  if (plan.status === 'ready' && plan.decision !== 'accept') {
    errors.push('ready quality plan must use decision accept')
  }
  if (plan.decision !== 'accept' && plan.status !== 'needs_review') {
    errors.push('non-accept quality decisions must use status needs_review')
  }
  if (plan.status === 'ready' && plan.decision === 'accept') {
    if (plan.readability !== 'readable') {
      errors.push('accepted material must be readable')
    }
    if (plan.knowledgeValue === 'none') {
      errors.push('accepted material must have knowledgeValue high, medium, or low')
    }
    if (plan.duplicateAssessment.status === 'duplicate') {
      errors.push('accepted material cannot be marked as duplicate')
    }
  }
  if (plan.status === 'ready' && plan.decision !== 'convert' && plan.evidence.length === 0) {
    errors.push('ready quality plan must cite at least one source quote unless the decision is convert')
  }
  if (plan.decision === 'convert' && plan.readability === 'readable' && plan.blockers.length === 0) {
    errors.push('convert decision needs a blocker when the source is already readable')
  }
  if ((plan.decision === 'merge' || plan.duplicateAssessment.status === 'duplicate' || plan.duplicateAssessment.status === 'possible_duplicate') && plan.duplicateAssessment.matchedRefs.length === 0) {
    errors.push('duplicate or merge decisions need duplicateAssessment.matchedRefs')
  }

  for (const evidence of plan.evidence) {
    if (!evidence.quote.trim()) {
      errors.push('quality evidence quote must not be empty')
      continue
    }
    if (!sourceIncludesQuote(input.artifact.content, evidence.quote)) {
      errors.push(`quality evidence quote is not present in the source: ${evidence.quote.slice(0, 80)}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid inbox quality plan: ${errors.join('; ')}`)
  }

  return plan
}

export function inboxQualityNeedsReviewReasons(plan: InboxQualityPlan): string[] {
  const reasons: string[] = []
  if (plan.status === 'needs_review') {
    reasons.push(plan.reason)
  }
  if (plan.decision !== 'accept') {
    reasons.push(`${plan.decision}: ${plan.reason}`)
  }
  for (const blocker of plan.blockers ?? []) {
    reasons.push(blocker)
  }
  return reasons.map((reason) => reason.trim()).filter(Boolean)
}

function normalizeDuplicateAssessment(value: unknown): InboxQualityPlan['duplicateAssessment'] {
  if (!isRecord(value)) {
    throw new Error('duplicateAssessment must be an object')
  }
  return {
    status: enumValue(value.status, ['new', 'duplicate', 'possible_duplicate', 'unknown'], 'duplicateAssessment.status'),
    matchedRefs: normalizeStringArray(value.matchedRefs, 'duplicateAssessment.matchedRefs'),
  }
}

function normalizeEvidence(value: unknown): InboxQualityEvidence[] {
  return normalizeArray(value, 'evidence').map((item, index) => {
    if (!isRecord(item)) throw new Error(`evidence[${index}] must be an object`)
    return {
      quote: requiredString(item.quote, `evidence[${index}].quote`),
      note: optionalString(item.note),
    }
  })
}

function normalizeStringArray(value: unknown, name: string): string[] {
  return normalizeArray(value, name).map((item, index) => requiredString(item, `${name}[${index}]`))
}

function normalizeArray(value: unknown, name: string): unknown[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`)
  }
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function optionalEnumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return enumValue(value, allowed, name)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function sourceIncludesQuote(source: string, quote: string): boolean {
  const normalizedSource = normalizeEvidenceText(source)
  const normalizedQuote = normalizeEvidenceText(quote)
  return normalizedQuote.length > 0 && normalizedSource.includes(normalizedQuote)
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
