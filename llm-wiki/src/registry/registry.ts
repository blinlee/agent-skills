import { runIngestJob, type IngestJobResult } from '../jobs/job-runner.js'
import type { QueryReadingMode } from '../query/intent.js'
import { type QueryRegistryCitation, type QueryRegistryResult, type QueryRegistryWikiResult } from '../retrieval/registry.js'
import { resolveRegistryPaths, type RegistryPaths } from './paths.js'
import { readRegistryState, runRegistryAdd, runRegistryInit, runRegistryList } from './state.js'
export { runRegistryAdd, runRegistryInit, runRegistryList } from './state.js'
import {
  findIntakeItemByRouteProposal,
  runIntakeComplete,
  runIntakeNext,
  runIntakePark,
  runIntakeReject,
  runIntakeScan,
  runIntakeStatus,
  updateIntakeItem,
} from './intake.js'
export {
  runIntakeComplete,
  runIntakeNext,
  runIntakePark,
  runIntakeReject,
  runIntakeScan,
  runIntakeStatus,
} from './intake.js'
import { runBridgeAccept, runBridgeCreateLanding, runBridgeIndex, runBridgeList, runBridgeReject, runBridgeTargets } from './bridge.js'
export { runBridgeAccept, runBridgeCreateLanding, runBridgeIndex, runBridgeList, runBridgeReject, runBridgeTargets } from './bridge.js'
import type { SourceSummary } from './source.js'
import {
  runProfileAccept,
  runProfileReject,
  runProfileReview,
  runProfileSuggest,
  type ProfileDecisionInput,
  type ProfileDecisionResult,
  type ProfileProposal,
  type ProfileProposalResult,
  type ProfileReviewResult,
  type ProfileSuggestInput,
} from './profile.js'
export { runProfileAccept, runProfileReject, runProfileReview, runProfileSuggest } from './profile.js'
export type { ProfileDecisionInput, ProfileDecisionResult, ProfileProposal, ProfileProposalResult, ProfileReviewResult, ProfileSuggestInput } from './profile.js'
import { runQueryRegistry } from './query.js'
export { runQueryRegistry } from './query.js'
import { runRoute, runRouteAccept, runRouteInbox } from './route.js'
export { runRoute, runRouteAccept, runRouteInbox } from './route.js'

export type RegistryCommandInput = {
  registryRoot: string
}

export type WikiRegistryEntry = {
  id: string
  title: string
  knowledgeRoot: string
  scopeCore: string[]
  scopeAdjacent: string[]
  scope: string[]
  outOfScope: string[]
  aliases: string[]
  conceptAliases: Array<{
    canonical: string
    aliases: string[]
  }>
  granularity: {
    preferredLevel: 'broad-domain' | 'field' | 'subfield' | 'project'
    splitWhen: string[]
    doNotSplitWhen: string[]
  }
  exampleAccept: string[]
  exampleReject: string[]
  profileNotes: string[]
  createdAt: string
  updatedAt: string
}

export type WikiRegistryState = {
  version: 1
  wikis: WikiRegistryEntry[]
}

export type RegistryInitResult = {
  registryRoot: string
  createdDirectories: string[]
  registryFile: string
}

export type RegistryAddInput = RegistryCommandInput & {
  knowledgeRoot?: string
  id: string
  title?: string
  scope?: string[]
  scopeCore?: string[]
  scopeAdjacent?: string[]
  outOfScope?: string[]
  aliases?: string[]
  profileNotes?: string[]
}

export type RegistryAddResult = {
  registryRoot: string
  wiki: WikiRegistryEntry
  registryFile: string
  profileFile: string
}

export type RegistryListResult = {
  registryRoot: string
  wikis: WikiRegistryEntry[]
}

export type RouteCandidate = {
  wikiId: string
  title: string
  knowledgeRoot: string
  score: number
  matchQuality: 'none' | 'weak' | 'moderate' | 'strong'
  relationshipHint: 'same_scheme' | 'possible_child_profile' | 'adjacent_family' | 'generic_overlap' | 'unrelated'
  matchedTerms: string[]
  focusedMatches: string[]
  coreMatches: string[]
  aliasMatches: string[]
  phraseMatches: string[]
  adjacentMatches: string[]
  genericMatches: string[]
  negativeMatches: string[]
  rationale: string
}

export type RouteDecisionType =
  | 'route_existing'
  | 'create_new_wiki'
  | 'park_for_later'
  | 'reject_source'
  | 'bridge_existing_wikis'

export type RouteProposal = {
  id: string
  status: 'proposed' | 'accepted' | 'rejected'
  decisionType: RouteDecisionType
  source: {
    input: string
    kind: 'local-file' | 'directory' | 'url' | 'unknown'
    sha256: string | null
    title: string
    excerpt: string
  }
  candidates: RouteCandidate[]
  recommendedWikiId: string | null
  confidence: 'low' | 'medium' | 'high'
  evidence: string[]
  risks: string[]
  humanQuestions: string[]
  newWikiProposalId: string | null
  parkReason: string | null
  rejectReason: string | null
  bridgeSuggestions: Array<{
    fromWikiId: string
    toWikiId: string
    rationale: string
  }>
  classificationPackageId: string
  classificationPackage: ClassificationPackage
  classificationPolicy: {
    summary: string
    newWikiRequiredSatisfied: string[]
    newWikiRequiredMissing: string[]
    requiredSatisfiedCount: number
    requiredThreshold: number
  }
  routingAssessment: {
    ownershipDecision: 'strong_existing' | 'new_profile' | 'park' | 'reject'
    relationshipHint: RouteCandidate['relationshipHint'] | 'source_map' | 'unsupported_source'
    nearestWikiId: string | null
    novelty: 'low' | 'medium' | 'high'
    rationale: string
    reviewFocus: string[]
  }
  humanReviewRequired: true
  intakeItemId?: string | null
  acceptedWikiId: string | null
  reviewer: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ClassificationPackage = {
  id: string
  routeProposalId: string
  intakeItemId: string | null
  humanReviewRequired: true
  sourceTitle: string
  primaryWiki: {
    wikiId: string
    confidence: 'low' | 'medium' | 'high'
    rationale: string
  } | null
  secondaryWikis: Array<{
    wikiId: string
    relation: 'bridge' | 'co-relevant' | 'possible-secondary'
    confidence: 'low' | 'medium' | 'high'
    rationale: string
  }>
  topics: Array<{
    slug: string
    title: string
    level: number
    parentSlug: string | null
    confidence: number
    rationale: string
  }>
  tags: string[]
  relatedPages: Array<{
    wikiId: string
    target: string
    title: string
    relationship: 'same-topic' | 'supporting-context' | 'possible-duplicate' | 'bridge-context'
    confidence: number
    rationale: string
  }>
  linkSuggestions: Array<{
    wikiId: string
    link: string
    target: string
    rationale: string
  }>
  proposedOperations: Array<{
    action: 'accept-primary-route' | 'accept-new-profile' | 'park' | 'reject' | 'review-bridge' | 'review-taxonomy'
    command: string | null
    requiresHumanApproval: true
    rationale: string
  }>
  reviewQuestions: string[]
  createdAt: string
}

export type RouteInput = RegistryCommandInput & {
  source: string
}

export type RouteResult = {
  registryRoot: string
  proposal: RouteProposal
  proposalFile: string
  classificationPackageFile: string
}

export type RouteAcceptInput = RegistryCommandInput & {
  proposalId: string
  wikiId?: string
  reviewer?: string
  qualityPath?: string
  curationPath?: string
}

export type RouteDecision = {
  status: 'accepted' | 'blocked'
  proposalId: string
  acceptedWikiId: string
  reviewer: string
  decidedAt: string
  ingestResult: IngestJobResult
}

export type RouteAcceptResult = {
  registryRoot: string
  proposalFile: string
  decisionFile: string
  bridgeProposalFiles: string[]
  decision: RouteDecision
}

export type BridgeProposal = {
  id: string
  status: 'proposed' | 'accepted' | 'rejected'
  routeProposalId: string
  fromWikiId: string
  toWikiId: string
  sourcePageTarget: string | null
  sourcePageFile: string | null
  suggestedLink: string
  rationale: string
  reviewer: string | null
  reviewedAt: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

export type BridgeListResult = {
  registryRoot: string
  proposalCount: number
  pendingCount: number
  proposals: BridgeProposal[]
}

export type BridgeDecisionInput = RegistryCommandInput & {
  proposalId: string
  reviewer: string
  reason?: string
  target?: string
}

export type BridgeCreateLandingInput = BridgeDecisionInput & {
  section?: string
  slug: string
}

export type BridgeEdge = {
  id: string
  proposalId: string
  status: 'resolved'
  fromWikiId: string
  fromTarget: string | null
  fromFilePath: string | null
  originalToWikiId: string
  toWikiId: string
  toTarget: string
  toFilePath: string
  link: string
  rationale: string
  reviewer: string
  reason: string | null
  decidedAt: string
  renderedAt: string | null
  retargeted: boolean
}

export type BridgeDecisionResult = {
  registryRoot: string
  proposal: BridgeProposal
  proposalFile: string
  edge?: BridgeEdge
  edgeFile?: string
  decisionFile?: string
  landingPageFile?: string
  files: string[]
}

export type BridgeTargetCandidate = {
  wikiId: string
  target: string
  title: string
  filePath: string
  link: string
  evidenceKind: 'wiki-page' | 'source-page'
  sourceRef: string | null
  rawPath: string | null
  excerpt: string
  rationale: string
  score: number
  readiness: {
    status: 'ready' | 'partial' | 'blocked' | 'unknown'
    indexStatus: string
  }
  diagnostics: string[]
}

export type BridgeTargetsInput = RegistryCommandInput & {
  proposalId: string
}

export type BridgeTargetsResult = {
  registryRoot: string
  proposal: BridgeProposal
  targetReadiness: {
    wikiId: string
    status: 'ready' | 'partial' | 'blocked'
    indexStatus: string
    diagnostics: string[]
  }
  candidates: BridgeTargetCandidate[]
}

export type QueryRegistryInput = RegistryCommandInput & {
  question: string
  readingMode?: QueryReadingMode
  citationBudget?: number
  maxCitationsPerWiki?: number
  maxConcurrentWikis?: number
}

export type { QueryRegistryCitation, QueryRegistryResult, QueryRegistryWikiResult }

export type IntakeItemStatus =
  | 'discovered'
  | 'route_proposed'
  | 'route_accepted'
  | 'ingested'
  | 'taxonomy_review'
  | 'taxonomy_resolved'
  | 'indexed'
  | 'completed'
  | 'rejected'
  | 'parked'
  | 'blocked'

export type IntakeItem = {
  id: string
  originalPath: string
  currentPath: string
  objectPath: string | null
  qualityPlanPath: string | null
  curationPlanPath: string | null
  fileName: string
  sourceKind: RouteProposal['source']['kind']
  sha256: string
  status: IntakeItemStatus
  routeProposalId: string | null
  targetWikiId: string | null
  taxonomyProposalSlugs: string[]
  wikiPages: string[]
  managedRawArchive: string | null
  reviewRequired: boolean
  lastError: string | null
  reviewer: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  rejectedAt: string | null
}

export type IntakeScanResult = {
  registryRoot: string
  inboxPath: string
  newCount: number
  pendingCount: number
  action: 'silent' | 'pending'
  discoveredItems: IntakeItem[]
  pendingItems: IntakeItem[]
}

export type IntakeStatusResult = {
  registryRoot: string
  pendingCount: number
  items: IntakeItem[]
  countsByStatus: Partial<Record<IntakeItemStatus, number>>
}

export type IntakeNextResult = {
  registryRoot: string
  action: 'silent' | 'route-source' | 'show-route-proposal' | 'continue-review' | 'complete-or-reject' | 'profile-review'
  item: IntakeItem | null
  message: string
  suggestedCommand: string | null
}

export type IntakeCompleteInput = RegistryCommandInput & {
  itemId: string
  reviewer?: string
}

export type IntakeRejectInput = RegistryCommandInput & {
  itemId: string
  reviewer: string
  reason: string
}

export type IntakeParkInput = RegistryCommandInput & {
  itemId: string
  reviewer: string
  reason: string
}

export type IntakeDecisionResult = {
  registryRoot: string
  item: IntakeItem
  itemFile: string
}


export type RouteInboxInput = RegistryCommandInput

export type RouteInboxResult = {
  registryRoot: string
  inboxPath: string
  scan: IntakeScanResult
  results: RouteResult[]
}

export type CrossWikiLinkEntry = {
  fromWikiId: string
  fromTarget: string | null
  fromFilePath: string | null
  toWikiId: string
  toTarget: string
  raw: string
  status: 'resolved' | 'unknown-wiki' | 'missing-page' | 'placeholder-target' | 'stale-edge' | 'unrendered-edge' | 'orphan-rendered-link'
  source: 'rendered-link' | 'structured-edge'
  edgeId?: string
}

export type BridgeIndexResult = {
  registryRoot: string
  generatedAt: string
  linkCount: number
  unresolvedCount: number
  bridgeFile: string
  links: CrossWikiLinkEntry[]
}
