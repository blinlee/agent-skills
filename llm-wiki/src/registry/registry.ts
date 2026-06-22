import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { runIngestJob, type IngestJobResult } from '../jobs/job-runner.js'
import { createSensitiveRedactor } from '../query/query.js'
import { runRegistryHybridRetrieval, type QueryRegistryCitation, type QueryRegistryResult, type QueryRegistryWikiResult } from '../retrieval/registry.js'
import { readJsonFile, writeJsonFile } from '../shared/fs.js'
import {
  appendJsonLine,
  normalizeWikiId,
  titleFromId,
  tokenize,
} from './helpers.js'
import { resolveRegistryPaths, type RegistryPaths } from './paths.js'
import { readRegistryState, runRegistryAdd, runRegistryInit, runRegistryList } from './state.js'
export { runRegistryAdd, runRegistryInit, runRegistryList } from './state.js'
import {
  findIntakeItemBySource,
  findIntakeItemByRouteProposal,
  readIntakeItem,
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
import { createBridgeProposalsAfterRouteAccept, runBridgeAccept, runBridgeIndex, runBridgeList, runBridgeReject } from './bridge.js'
export { runBridgeAccept, runBridgeIndex, runBridgeList, runBridgeReject } from './bridge.js'
import { buildClassificationPackage } from './classification.js'
import { rankWikis, profilePositiveTerms } from './ranking.js'
import {
  classifyRouteProposal,
  buildDraftWikiProfile,
  evaluateNewWikiCriteria,
  suggestWikiId,
  profileProposalFile,
  markProfileProposalReviewed,
  updateIntakeItemAfterRouteAcceptance,
  readRouteDecisions,
} from './proposal.js'
import { summarizeSource, type SourceSummary } from './source.js'

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
}

export type RouteDecision = {
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
}

export type BridgeDecisionResult = {
  registryRoot: string
  proposal: BridgeProposal
  proposalFile: string
  files: string[]
}

export type QueryRegistryInput = RegistryCommandInput & {
  question: string
  citationBudget?: number
  maxCitationsPerWiki?: number
  maxConcurrentWikis?: number
}

export type { QueryRegistryCitation, QueryRegistryResult, QueryRegistryWikiResult }

export type ProfileProposal = {
  id: string
  status: 'proposed' | 'accepted' | 'rejected'
  kind: 'create_wiki' | 'refine_wiki'
  targetWikiId: string | null
  proposedWiki: WikiRegistryEntry | null
  rationale: string
  evidence: string[]
  risks: string[]
  reviewQuestions: string[]
  sourceIntakeItemId: string | null
  sourceRouteProposalId: string | null
  newWikiCriteria: {
    satisfied: string[]
    missing: string[]
    requiredThreshold: number
  }
  reviewer: string | null
  reviewedAt: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

export type ProfileSuggestInput = RegistryCommandInput & {
  intakeItemId?: string
  source?: string
  id?: string
  title?: string
}

export type ProfileProposalResult = {
  registryRoot: string
  proposal: ProfileProposal
  proposalFile: string
}

export type ProfileDecisionInput = RegistryCommandInput & {
  proposalId: string
  reviewer: string
  reason?: string
}

export type ProfileDecisionResult = {
  registryRoot: string
  proposal: ProfileProposal
  proposalFile: string
  registryFile: string
  profileFile: string | null
}

export type ProfileReviewResult = {
  registryRoot: string
  generatedAt: string
  wikis: Array<{
    wikiId: string
    title: string
    acceptedRoutes: number
    weakAcceptedRoutes: number
    suggestedAliases: string[]
    driftRisks: string[]
  }>
  guidance: string[]
}


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


export async function runRoute(input: RouteInput): Promise<RouteResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)

  const source = await summarizeSource(input.source)
  const candidates = rankWikis(source.searchText, state.wikis, source.title ? `${source.title}\n${source.excerpt}` : source.searchText)
  const classification = await classifyRouteProposal(paths, source, candidates, state.wikis, await findIntakeItemBySource(paths, input.source))
  const now = new Date().toISOString()
  const proposalId = `route-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`
  const classificationPackage = await buildClassificationPackage(paths, {
    routeProposalId: proposalId,
    intakeItemId: classification.intakeItemId,
    source,
    candidates,
    wikis: state.wikis,
    recommendedWikiId: classification.recommendedWikiId,
    confidence: classification.confidence,
    bridgeSuggestions: classification.bridgeSuggestions,
    newWikiProposalId: classification.newWikiProposalId,
    decisionType: classification.decisionType,
    createdAt: now,
  })
  const proposal: RouteProposal = {
    id: proposalId,
    status: 'proposed',
    decisionType: classification.decisionType,
    source: {
      input: input.source,
      kind: source.kind,
      sha256: source.sha256,
      title: source.title,
      excerpt: source.excerpt,
    },
    candidates,
    recommendedWikiId: classification.recommendedWikiId,
    confidence: classification.confidence,
    evidence: classification.evidence,
    risks: classification.risks,
    humanQuestions: classification.humanQuestions,
    newWikiProposalId: classification.newWikiProposalId,
    parkReason: classification.parkReason,
    rejectReason: classification.rejectReason,
    bridgeSuggestions: classification.bridgeSuggestions,
    classificationPackageId: classificationPackage.id,
    classificationPackage,
    classificationPolicy: classification.classificationPolicy,
    routingAssessment: classification.routingAssessment,
    humanReviewRequired: true,
    intakeItemId: classification.intakeItemId,
    acceptedWikiId: null,
    reviewer: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  const proposalFile = path.join(paths.routingProposalsDirectory, `${proposal.id}.json`)
  const classificationPackageFile = path.join(paths.classificationPackagesDirectory, `${classificationPackage.id}.json`)
  await writeJsonFile(classificationPackageFile, classificationPackage)
  await writeJsonFile(proposalFile, proposal)

  return {
    registryRoot: paths.root,
    proposal,
    proposalFile,
    classificationPackageFile,
  }
}

export async function runRouteAccept(input: RouteAcceptInput): Promise<RouteAcceptResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  const proposalFile = path.join(paths.routingProposalsDirectory, `${input.proposalId}.json`)
  const proposal = await readJsonFile<RouteProposal | null>(proposalFile, null)
  if (!proposal) {
    throw new Error(`Route proposal does not exist: ${input.proposalId}`)
  }

  const acceptedWikiId = normalizeWikiId(input.wikiId ?? proposal.recommendedWikiId ?? '')
  if (!acceptedWikiId) {
    throw new Error(`Route proposal ${input.proposalId} has no recommended wiki; pass --wiki <id> to accept explicitly.`)
  }

  const wiki = state.wikis.find((entry) => entry.id === acceptedWikiId)
  if (!wiki) {
    throw new Error(`Unknown wiki id for route acceptance: ${acceptedWikiId}`)
  }

  const reviewer = input.reviewer?.trim() || 'human'
  const ingestResult = await runIngestJob({ knowledgeRoot: wiki.knowledgeRoot, input: proposal.source.input })
  const now = new Date().toISOString()
  const acceptedProposal: RouteProposal = {
    ...proposal,
    status: 'accepted',
    acceptedWikiId: wiki.id,
    reviewer,
    reviewedAt: now,
    updatedAt: now,
  }
  const decision: RouteDecision = {
    proposalId: proposal.id,
    acceptedWikiId: wiki.id,
    reviewer,
    decidedAt: now,
    ingestResult,
  }
  const decisionFile = path.join(paths.routingDecisionsDirectory, `${proposal.id}.json`)

  await writeJsonFile(proposalFile, acceptedProposal)
  await writeJsonFile(decisionFile, decision)
  await updateIntakeItemAfterRouteAcceptance(paths, acceptedProposal, ingestResult, wiki.id, reviewer)
  const bridgeProposalFiles = await createBridgeProposalsAfterRouteAccept(paths, acceptedProposal, ingestResult, wiki.id)

  return {
    registryRoot: paths.root,
    proposalFile,
    decisionFile,
    bridgeProposalFiles,
    decision,
  }
}

export async function runQueryRegistry(input: QueryRegistryInput): Promise<QueryRegistryResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  if (state.wikis.length === 0) {
    throw new Error(`Cannot query registry: no wikis are registered in ${paths.registryFile}`)
  }

  const redactor = createSensitiveRedactor(input.question)
  const displayQuestion = redactor(input.question)
  const rankedWikis = rankWikis(input.question, state.wikis)
  const selected = rankedWikis

  const retrievalResult = await runRegistryHybridRetrieval({
    question: input.question,
    selectedWikis: selected,
    citationBudget: input.citationBudget,
    maxCitationsPerWiki: input.maxCitationsPerWiki,
    maxConcurrentWikis: input.maxConcurrentWikis,
  })
  await appendJsonLine(paths.queryLog, {
    question: displayQuestion,
    selectedWikis: retrievalResult.selectedWikis.map((wiki) => ({ wikiId: wiki.wikiId, score: wiki.score, chunkScore: wiki.chunkScore })),
    resultCount: retrievalResult.results.filter((entry) => entry.result).length,
    createdAt: new Date().toISOString(),
  })

  return {
    question: displayQuestion,
    ...retrievalResult,
  }
}

export async function runProfileSuggest(input: ProfileSuggestInput): Promise<ProfileProposalResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })

  const item = input.intakeItemId ? await readIntakeItem(paths, input.intakeItemId) : null
  const sourcePath = input.source ?? (item ? path.join(paths.root, item.currentPath) : null)
  if (!sourcePath) {
    throw new Error('profile-suggest requires --from <intakeItemId> or --source <sourcePathOrUrl>.')
  }

  const source = await summarizeSource(sourcePath)
  const state = await readRegistryState(paths)
  const candidates = rankWikis(source.searchText, state.wikis, `${source.title}\n${source.excerpt}`)
  const criteria = evaluateNewWikiCriteria(source, candidates)
  const proposedId = normalizeWikiId(input.id ?? suggestWikiId(source.title, source.searchText))
  const now = new Date().toISOString()
  const proposedWiki = buildDraftWikiProfile({
    paths,
    id: proposedId,
    title: input.title?.trim() || titleFromId(proposedId),
    source,
    existingWikis: state.wikis,
    now,
  })
  const proposal: ProfileProposal = {
    id: `profile-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
    status: 'proposed',
    kind: 'create_wiki',
    targetWikiId: proposedWiki.id,
    proposedWiki,
    rationale: '当材料没有强匹配的已有 wiki 时，不应静默扩大某个 wiki 的范围。这个提案只是一个待人工确认的 wiki 边界草稿。',
    evidence: [
      `材料标题：${source.title}`,
      `最接近的已有候选：${candidates[0]?.wikiId ?? '无'}（${candidates[0]?.score ?? 0}）`,
      `草稿核心范围：${proposedWiki.scopeCore.join(', ') || proposedWiki.title}`,
    ],
    risks: [
      '如果后续不会持续加入同类材料，只凭一个材料新建 wiki 可能太窄。',
      '如果接受过宽的 profile，后续分类和检索都会被污染。',
    ],
    reviewQuestions: [
      '这个方向后续是否会继续收集材料？',
      '它是一个独立治理边界，还是已有 wiki 里的一个主题？',
      '排除范围是否足够清楚，能防止以后漂移？',
    ],
    sourceIntakeItemId: item?.id ?? null,
    sourceRouteProposalId: null,
    newWikiCriteria: criteria,
    reviewer: null,
    reviewedAt: null,
    reason: null,
    createdAt: now,
    updatedAt: now,
  }
  const proposalFile = path.join(paths.profileProposalsDirectory, `${proposal.id}.json`)
  await writeJsonFile(proposalFile, proposal)

  return { registryRoot: paths.root, proposal, proposalFile }
}

export async function runProfileAccept(input: ProfileDecisionInput): Promise<ProfileDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposalFile = profileProposalFile(paths, input.proposalId)
  const proposal = await readJsonFile<ProfileProposal | null>(proposalFile, null)
  if (!proposal) {
    throw new Error(`Profile proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('profile-accept requires --reviewer <name> after human confirmation.')
  }
  if (proposal.kind !== 'create_wiki' || !proposal.proposedWiki) {
    throw new Error(`Profile proposal ${proposal.id} cannot be accepted as a create-wiki proposal.`)
  }

  const addResult = await runRegistryAdd({
    registryRoot: paths.root,
    id: proposal.proposedWiki.id,
    title: proposal.proposedWiki.title,
    scopeCore: proposal.proposedWiki.scopeCore,
    scopeAdjacent: proposal.proposedWiki.scopeAdjacent,
    outOfScope: proposal.proposedWiki.outOfScope,
    aliases: proposal.proposedWiki.aliases,
    profileNotes: proposal.proposedWiki.profileNotes,
  })
  const accepted = markProfileProposalReviewed(proposal, 'accepted', input.reviewer, input.reason ?? null)
  await writeJsonFile(proposalFile, accepted)
  const decisionFile = path.join(paths.profileDecisionsDirectory, `${proposal.id}.json`)
  await writeJsonFile(decisionFile, {
    proposalId: proposal.id,
    acceptedWikiId: addResult.wiki.id,
    reviewer: input.reviewer.trim(),
    reason: input.reason ?? null,
    decidedAt: accepted.reviewedAt,
  })

  return {
    registryRoot: paths.root,
    proposal: accepted,
    proposalFile,
    registryFile: addResult.registryFile,
    profileFile: addResult.profileFile,
  }
}

export async function runProfileReject(input: ProfileDecisionInput): Promise<ProfileDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposalFile = profileProposalFile(paths, input.proposalId)
  const proposal = await readJsonFile<ProfileProposal | null>(proposalFile, null)
  if (!proposal) {
    throw new Error(`Profile proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('profile-reject requires --reviewer <name>.')
  }
  if (!input.reason?.trim()) {
    throw new Error('profile-reject requires --reason <reason>.')
  }
  const rejected = markProfileProposalReviewed(proposal, 'rejected', input.reviewer, input.reason)
  await writeJsonFile(proposalFile, rejected)
  return {
    registryRoot: paths.root,
    proposal: rejected,
    proposalFile,
    registryFile: paths.registryFile,
    profileFile: null,
  }
}

export async function runProfileReview(input: RegistryCommandInput): Promise<ProfileReviewResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  const decisions = await readRouteDecisions(paths)
  const generatedAt = new Date().toISOString()

  return {
    registryRoot: paths.root,
    generatedAt,
    wikis: state.wikis.map((wiki) => {
      const accepted = decisions.filter((decision) => decision.acceptedWikiId === wiki.id)
      const weakAccepted = accepted.filter((decision) => {
        const proposal = decision.proposal
        return proposal ? (proposal.candidates.find((candidate) => candidate.wikiId === wiki.id)?.score ?? 0) < 1 : false
      })
      const suggestedAliases = [...new Set(accepted.flatMap((decision) => tokenize(decision.proposal?.source.title ?? '').slice(0, 4)))]
        .filter((term) => !profilePositiveTerms(wiki).includes(term))
        .slice(0, 8)
      return {
        wikiId: wiki.id,
        title: wiki.title,
        acceptedRoutes: accepted.length,
        weakAcceptedRoutes: weakAccepted.length,
        suggestedAliases,
        driftRisks: [
          weakAccepted.length > 0 ? `${weakAccepted.length} 条已接受路由只有弱匹配；建议检查是否要收紧范围或补充别名。` : null,
          wiki.scopeCore.length === 0 ? '这个 profile 没有核心范围；当前路由过度依赖标题/id。' : null,
        ].filter((value): value is string => Boolean(value)),
      }
    }),
    guidance: [
      'profile 变更必须先作为提案审核：不要因为一个材料勉强匹配，就静默扩大某个 wiki。',
      '如果反复接受同类材料，优先补别名；只有当术语、查询意图、材料标准、规模和污染风险都支持时，才拆分或新建 wiki。',
      '如果某个 wiki 累积了很多弱匹配收入项，请检查它是范围太宽、太窄，还是缺少相邻范围说明。',
    ],
  }
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
  fromTarget: string
  fromFilePath: string
  toWikiId: string
  toTarget: string
  raw: string
  status: 'resolved' | 'unknown-wiki' | 'missing-page'
}

export type BridgeIndexResult = {
  registryRoot: string
  generatedAt: string
  linkCount: number
  unresolvedCount: number
  bridgeFile: string
  links: CrossWikiLinkEntry[]
}

export async function runRouteInbox(input: RouteInboxInput): Promise<RouteInboxResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const scan = await runIntakeScan({ registryRoot: paths.root })
  const items = scan.pendingItems
    .filter((item) => item.status === 'discovered' || item.status === 'blocked')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  const results: RouteResult[] = []

  for (const item of items) {
    try {
      const source = path.join(paths.root, item.currentPath)
      const routeResult = await runRoute({ registryRoot: paths.root, source })
      results.push(routeResult)
      await updateIntakeItem(paths, item.id, (current) => ({
        ...current,
        status: 'route_proposed',
        routeProposalId: routeResult.proposal.id,
        lastError: null,
        updatedAt: new Date().toISOString(),
      }), 'route-proposed')
    } catch (error) {
      await updateIntakeItem(paths, item.id, (current) => ({
        ...current,
        status: 'blocked',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }), 'route-blocked')
    }
  }

  return {
    registryRoot: paths.root,
    inboxPath: paths.inboxDirectory,
    scan,
    results,
  }
}
