import { createHash, randomUUID } from 'node:crypto'
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runIngestJob, type IngestJobResult } from '../jobs/job-runner'
import { loadIndexedPages } from '../query/query'
import { runQuery, type QueryCommandResult } from '../query/query'
import { ensureKnowledgeRootLayout } from '../paths'

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
  matchedTerms: string[]
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
  maxWikis?: number
}

export type QueryRegistryWikiResult = {
  wikiId: string
  title: string
  knowledgeRoot: string
  score: number
  matchedTerms: string[]
  result: QueryCommandResult | null
  error: string | null
}

export type QueryRegistryResult = {
  question: string
  answer: string
  selectedWikis: Array<Pick<QueryRegistryWikiResult, 'wikiId' | 'title' | 'knowledgeRoot' | 'score' | 'matchedTerms'>>
  results: QueryRegistryWikiResult[]
}

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

type RegistryPaths = {
  root: string
  registryDirectory: string
  registryFile: string
  profilesDirectory: string
  profileProposalsDirectory: string
  profileDecisionsDirectory: string
  classificationPackagesDirectory: string
  routingProposalsDirectory: string
  routingDecisionsDirectory: string
  bridgesDirectory: string
  bridgeProposalsDirectory: string
  bridgeDecisionsDirectory: string
  wikisDirectory: string
  inboxDirectory: string
  rawObjectsDirectory: string
  intakeItemsDirectory: string
  intakeSpoolDirectory: string
  intakeEvents: string
  intakeLocksDirectory: string
  atlasIndexDirectory: string
  ragDirectory: string
  queryLog: string
}

const REGISTRY_DIRECTORIES = [
  'registry',
  'registry/profiles',
  'registry/profiles/proposals',
  'registry/profiles/decisions',
  'registry/classification/packages',
  'registry/routing/proposals',
  'registry/routing/decisions',
  'registry/bridges',
  'registry/bridges/proposals',
  'registry/bridges/decisions',
  'raw/inbox',
  'raw/objects',
  'wikis',
  'system/intake/items',
  'system/intake/spool',
  'system/intake/locks',
  'system/index',
  'system/rag',
] as const

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'what', 'with', 'this', 'that', 'into', 'about',
  'can', 'do', 'does', 'our', 'their', 'these', 'those', 'use', 'used', 'using', 'we', 'you',
])

const CLASSIFICATION_TOPIC_NOISE_WORDS = new Set([
  ...STOP_WORDS,
  'article',
  'author',
  'background',
  'build',
  'building',
  'built',
  'choose',
  'choosing',
  'complete',
  'configure',
  'configuring',
  'debug',
  'debugging',
  'digest',
  'doc',
  'docs',
  'documentation',
  'effective',
  'example',
  'examples',
  'existing',
  'guide',
  'include',
  'including',
  'index',
  'lesson',
  'lessons',
  'long',
  'note',
  'notes',
  'official',
  'overview',
  'reference',
  'related',
  'running',
  'saved',
  'source',
  'title',
  'url',
])

export async function runRegistryInit(input: RegistryCommandInput): Promise<RegistryInitResult> {
  const paths = resolveRegistryPaths(input.registryRoot)

  await Promise.all(REGISTRY_DIRECTORIES.map((directory) => mkdir(path.join(paths.root, directory), { recursive: true })))
  await ensureJsonFile(paths.registryFile, { version: 1, wikis: [] } satisfies WikiRegistryState)
  await ensureTextFile(paths.queryLog, '')
  await ensureTextFile(paths.intakeEvents, '')

  return {
    registryRoot: paths.root,
    createdDirectories: [...REGISTRY_DIRECTORIES],
    registryFile: paths.registryFile,
  }
}

export async function runRegistryAdd(input: RegistryAddInput): Promise<RegistryAddResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })

  const state = await readRegistryState(paths)
  const now = new Date().toISOString()
  const id = normalizeWikiId(input.id)
  if (!id) {
    throw new Error('registry-add requires a non-empty --id value using letters, numbers, dot, underscore, or dash.')
  }

  const knowledgeRoot = input.knowledgeRoot
    ? path.resolve(input.knowledgeRoot)
    : path.join(paths.wikisDirectory, id)
  await ensureKnowledgeRootLayout(knowledgeRoot)

  const existing = state.wikis.find((wiki) => wiki.id === id)
  const explicitScopeCore = normalizeStringList(input.scopeCore ?? [])
  const explicitScopeAdjacent = normalizeStringList(input.scopeAdjacent ?? [])
  const scopeCore = explicitScopeCore.length > 0
    ? explicitScopeCore
    : normalizeStringList(input.scope ?? existing?.scopeCore ?? existing?.scope ?? [])
  const scopeAdjacent = explicitScopeAdjacent.length > 0
    ? explicitScopeAdjacent
    : normalizeStringList(existing?.scopeAdjacent ?? [])
  const outOfScope = normalizeStringList(input.outOfScope ?? existing?.outOfScope ?? [])
  const wiki: WikiRegistryEntry = {
    id,
    title: input.title?.trim() || existing?.title || titleFromId(id),
    knowledgeRoot,
    scopeCore,
    scopeAdjacent,
    scope: [...new Set([...scopeCore, ...scopeAdjacent])],
    outOfScope,
    aliases: normalizeStringList(input.aliases ?? existing?.aliases ?? []),
    conceptAliases: existing?.conceptAliases ?? [],
    granularity: existing?.granularity ?? defaultGranularityPolicy(),
    exampleAccept: existing?.exampleAccept ?? [],
    exampleReject: existing?.exampleReject ?? [],
    profileNotes: normalizeStringList(input.profileNotes ?? existing?.profileNotes ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (existing) {
    Object.assign(existing, wiki)
  } else {
    state.wikis.push(wiki)
  }
  state.wikis.sort((left, right) => left.id.localeCompare(right.id))

  const profileFile = path.join(paths.profilesDirectory, `${wiki.id}.json`)
  await writeJsonFile(paths.registryFile, state)
  await writeJsonFile(profileFile, wiki)

  return {
    registryRoot: paths.root,
    wiki,
    registryFile: paths.registryFile,
    profileFile,
  }
}

export async function runRegistryList(input: RegistryCommandInput): Promise<RegistryListResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  return {
    registryRoot: paths.root,
    wikis: state.wikis,
  }
}

export async function runRoute(input: RouteInput): Promise<RouteResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)

  const source = await summarizeSource(input.source)
  const candidates = rankWikis(source.searchText, state.wikis)
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

  const rankedWikis = rankWikis(input.question, state.wikis)
  const selected = (rankedWikis.some((wiki) => wiki.score > 0) ? rankedWikis.filter((wiki) => wiki.score > 0) : rankedWikis)
    .slice(0, Math.max(1, input.maxWikis ?? 3))

  const results: QueryRegistryWikiResult[] = []
  for (const wiki of selected) {
    try {
      const result = await runQuery({ knowledgeRoot: wiki.knowledgeRoot, question: input.question })
      results.push({ ...wiki, result, error: null })
    } catch (error) {
      results.push({ ...wiki, result: null, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const answer = buildRegistryAnswer(input.question, results)
  await appendJsonLine(paths.queryLog, {
    question: input.question,
    selectedWikis: selected.map((wiki) => ({ wikiId: wiki.wikiId, score: wiki.score })),
    resultCount: results.filter((entry) => entry.result).length,
    createdAt: new Date().toISOString(),
  })

  return {
    question: input.question,
    answer,
    selectedWikis: selected.map(({ wikiId, title, knowledgeRoot, score, matchedTerms }) => ({ wikiId, title, knowledgeRoot, score, matchedTerms })),
    results,
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
  const candidates = rankWikis(source.searchText, state.wikis)
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
    rationale: 'No existing wiki should be expanded silently when the source lacks a strong fit. This proposal creates a bounded profile draft for human review.',
    evidence: [
      `Source title: ${source.title}`,
      `Top existing candidate: ${candidates[0]?.wikiId ?? 'none'} (${candidates[0]?.score ?? 0})`,
      `Draft core scope: ${proposedWiki.scopeCore.join(', ') || proposedWiki.title}`,
    ],
    risks: [
      'Creating a wiki from a single source may be too narrow unless future corpus growth is expected.',
      'Accepting an over-broad profile will pollute later routing and retrieval.',
    ],
    reviewQuestions: [
      'Do you expect to collect more sources in this domain?',
      'Is this a governance boundary, or only a topic inside an existing wiki?',
      'Are the proposed out-of-scope rules strong enough to prevent drift?',
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
          weakAccepted.length > 0 ? `${weakAccepted.length} accepted route(s) had weak profile match; consider tightening scope or adding aliases.` : null,
          wiki.scopeCore.length === 0 ? 'Profile has no core scope; routing depends too much on title/id.' : null,
        ].filter((value): value is string => Boolean(value)),
      }
    }),
    guidance: [
      'Treat profile changes as proposals: do not silently broaden a wiki because one source barely matched.',
      'Prefer adding aliases for repeated accepted decisions; prefer split/new wiki only when independent terminology, retrieval intent, source standards, scale, and pollution risk support it.',
      'If a wiki accumulates weak accepted routes, review whether it is too broad, too narrow, or missing adjacent scope.',
    ],
  }
}

export async function runIntakeScan(input: RegistryCommandInput): Promise<IntakeScanResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })

  const entries = await readdir(paths.inboxDirectory, { withFileTypes: true })
  const discoveredItems: IntakeItem[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() && !entry.isDirectory()) {
      continue
    }

    const sourcePath = path.join(paths.inboxDirectory, entry.name)
    const now = new Date().toISOString()
    const id = `src-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`
    const sha256 = await hashIntakeSource(sourcePath)
    const objectPath = await moveInboxSourceToObjectStore({
      paths,
      sourcePath,
      fileName: entry.name,
      sha256,
    })

    const item: IntakeItem = {
      id,
      originalPath: path.relative(paths.root, sourcePath),
      currentPath: path.relative(paths.root, objectPath),
      objectPath: path.relative(paths.root, objectPath),
      fileName: entry.name,
      sourceKind: entry.isDirectory() ? 'directory' : detectRouteSourceKind(entry.name),
      sha256,
      status: 'discovered',
      routeProposalId: null,
      targetWikiId: null,
      taxonomyProposalSlugs: [],
      wikiPages: [],
      managedRawArchive: null,
      reviewRequired: true,
      lastError: null,
      reviewer: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      rejectedAt: null,
    }
    await writeIntakeItem(paths, item)
    await appendIntakeEvent(paths, { type: 'discovered', itemId: item.id, path: item.currentPath, objectPath: item.objectPath, createdAt: now })
    discoveredItems.push(item)
  }

  const pendingItems = (await readIntakeItems(paths))
    .filter((item) => !isTerminalIntakeStatus(item.status))
    .sort(compareIntakeItems)

  return {
    registryRoot: paths.root,
    inboxPath: paths.inboxDirectory,
    newCount: discoveredItems.length,
    pendingCount: pendingItems.length,
    action: pendingItems.length === 0 ? 'silent' : 'pending',
    discoveredItems,
    pendingItems,
  }
}

export async function runIntakeStatus(input: RegistryCommandInput): Promise<IntakeStatusResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const items = (await readIntakeItems(paths)).sort(compareIntakeItems)
  const countsByStatus: Partial<Record<IntakeItemStatus, number>> = {}

  for (const item of items) {
    countsByStatus[item.status] = (countsByStatus[item.status] ?? 0) + 1
  }

  return {
    registryRoot: paths.root,
    pendingCount: items.filter((item) => !isTerminalIntakeStatus(item.status)).length,
    items,
    countsByStatus,
  }
}

async function moveInboxSourceToObjectStore(input: {
  paths: RegistryPaths
  sourcePath: string
  fileName: string
  sha256: string
}): Promise<string> {
  const shard = input.sha256.slice(0, 2)
  const objectDirectory = path.join(input.paths.rawObjectsDirectory, shard, input.sha256)
  const objectPath = path.join(objectDirectory, input.fileName)

  await mkdir(objectDirectory, { recursive: true })

  if (await exists(objectPath)) {
    await rm(input.sourcePath, { recursive: true, force: true })
    return objectPath
  }

  await rename(input.sourcePath, objectPath)
  return objectPath
}

export async function runIntakeNext(input: RegistryCommandInput): Promise<IntakeNextResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  const scan = await runIntakeScan({ registryRoot: paths.root })
  const item = scan.pendingItems[0] ?? null

  if (!item) {
    return {
      registryRoot: paths.root,
      action: 'silent',
      item: null,
      message: 'No new or pending raw sources. A scheduled agent can exit silently.',
      suggestedCommand: null,
    }
  }

  const routeCommand = `llm-wiki route ${shellQuote(paths.root)} ${shellQuote(path.join(paths.root, item.currentPath))}`
  const acceptCommand = item.routeProposalId
    ? `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(item.routeProposalId)} --wiki <wiki-id> --reviewer <name>`
    : null

  if (item.status === 'discovered' || item.status === 'blocked') {
    return {
      registryRoot: paths.root,
      action: 'route-source',
      item,
      message: 'Show the source summary and route proposal to the human before ingesting.',
      suggestedCommand: routeCommand,
    }
  }

  if (item.status === 'route_proposed') {
    const proposal = item.routeProposalId
      ? await readJsonFile<RouteProposal | null>(path.join(paths.routingProposalsDirectory, `${item.routeProposalId}.json`), null)
      : null
    if (proposal?.decisionType === 'create_new_wiki' && proposal.newWikiProposalId) {
      return {
        registryRoot: paths.root,
        action: 'profile-review',
        item,
        message: 'The source did not strongly match existing profiles. Show the proposed new wiki profile and ask the human whether to create it, park, reject, or override into an existing wiki.',
        suggestedCommand: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(proposal.newWikiProposalId)} --reviewer <name>`,
      }
    }
    return {
      registryRoot: paths.root,
      action: 'show-route-proposal',
      item,
      message: 'Display the proposed target wiki, candidates, and rationale; wait for explicit human acceptance.',
      suggestedCommand: acceptCommand,
    }
  }

  if (item.status === 'route_accepted' || item.status === 'ingested' || item.status === 'taxonomy_review' || item.status === 'taxonomy_resolved' || item.status === 'indexed') {
    return {
      registryRoot: paths.root,
      action: 'continue-review',
      item,
      message: 'Continue pending review/index checks, then complete or reject the intake item with an explicit reviewer.',
      suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
    }
  }

  return {
    registryRoot: paths.root,
    action: 'complete-or-reject',
    item,
    message: 'Resolve this intake item by completing or rejecting it explicitly.',
    suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
  }
}

export async function runIntakeComplete(input: IntakeCompleteInput): Promise<IntakeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const reviewer = input.reviewer?.trim() || 'human'
  const item = await updateIntakeItem(paths, input.itemId, (current) => ({
    ...current,
    status: 'completed',
    reviewer,
    reason: null,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), 'completed')

  return {
    registryRoot: paths.root,
    item,
    itemFile: intakeItemFile(paths, item.id),
  }
}

export async function runIntakeReject(input: IntakeRejectInput): Promise<IntakeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const reviewer = input.reviewer.trim()
  const reason = input.reason.trim()
  if (!reviewer) {
    throw new Error('intake-reject requires --reviewer <name> after human review.')
  }
  if (!reason) {
    throw new Error('intake-reject requires --reason <reason>.')
  }

  const item = await updateIntakeItem(paths, input.itemId, (current) => ({
    ...current,
    status: 'rejected',
    reviewer,
    reason,
    rejectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), 'rejected')

  return {
    registryRoot: paths.root,
    item,
    itemFile: intakeItemFile(paths, item.id),
  }
}

export async function runIntakePark(input: IntakeParkInput): Promise<IntakeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const reviewer = input.reviewer.trim()
  const reason = input.reason.trim()
  if (!reviewer) {
    throw new Error('intake-park requires --reviewer <name>.')
  }
  if (!reason) {
    throw new Error('intake-park requires --reason <reason>.')
  }

  const item = await updateIntakeItem(paths, input.itemId, (current) => ({
    ...current,
    status: 'parked',
    reviewer,
    reason,
    reviewRequired: false,
    updatedAt: new Date().toISOString(),
  }), 'parked')

  return {
    registryRoot: paths.root,
    item,
    itemFile: intakeItemFile(paths, item.id),
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

export async function runBridgeIndex(input: RegistryCommandInput): Promise<BridgeIndexResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  const links: CrossWikiLinkEntry[] = []

  for (const wiki of state.wikis) {
    let indexedPages: Awaited<ReturnType<typeof loadIndexedPages>> = []
    try {
      indexedPages = await loadIndexedPages(wiki.knowledgeRoot)
    } catch {
      continue
    }
    const targetsByWiki = new Map(state.wikis.map((entry) => [entry.id, entry]))

    for (const page of indexedPages) {
      let content = ''
      try {
        content = await readFile(page.filePath, 'utf8')
      } catch {
        continue
      }

      for (const match of content.matchAll(/llm-wiki:\/\/([^/\s)\]]+)\/([^\s)\]]+)/g)) {
        const toWikiId = normalizeWikiId(match[1] ?? '')
        const toTarget = (match[2] ?? '').replace(/[.,;:]+$/g, '').replace(/\.md$/i, '')
        const targetWiki = targetsByWiki.get(toWikiId)
        let status: CrossWikiLinkEntry['status'] = 'resolved'
        if (!targetWiki) {
          status = 'unknown-wiki'
        } else {
          const targetFile = path.join(targetWiki.knowledgeRoot, 'wiki', `${toTarget}.md`)
          if (!(await exists(targetFile))) {
            status = 'missing-page'
          }
        }
        links.push({
          fromWikiId: wiki.id,
          fromTarget: page.target,
          fromFilePath: page.filePath,
          toWikiId,
          toTarget,
          raw: match[0],
          status,
        })
      }
    }
  }

  const generatedAt = new Date().toISOString()
  const bridgeFile = path.join(paths.bridgesDirectory, 'cross-wiki-links.json')
  await writeJsonFile(bridgeFile, {
    version: 1,
    registryRoot: paths.root,
    generatedAt,
    links,
  })

  return {
    registryRoot: paths.root,
    generatedAt,
    linkCount: links.length,
    unresolvedCount: links.filter((link) => link.status !== 'resolved').length,
    bridgeFile,
    links,
  }
}

export async function runBridgeList(input: RegistryCommandInput): Promise<BridgeListResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposals = await readBridgeProposals(paths)
  return {
    registryRoot: paths.root,
    proposalCount: proposals.length,
    pendingCount: proposals.filter((proposal) => proposal.status === 'proposed').length,
    proposals,
  }
}

export async function runBridgeAccept(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposal = await readBridgeProposal(paths, input.proposalId)
  if (!proposal) {
    throw new Error(`Bridge proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('bridge-accept requires --reviewer <name> after human confirmation.')
  }
  const now = new Date().toISOString()
  const accepted: BridgeProposal = {
    ...proposal,
    status: 'accepted',
    reviewer: input.reviewer.trim(),
    reviewedAt: now,
    reason: input.reason ?? null,
    updatedAt: now,
  }
  const files = [bridgeProposalFile(paths, accepted.id)]
  if (accepted.sourcePageFile) {
    await appendBridgeLinkToSourcePage(accepted.sourcePageFile, accepted.suggestedLink, accepted.rationale)
    files.push(accepted.sourcePageFile)
  }
  await writeJsonFile(bridgeProposalFile(paths, accepted.id), accepted)
  await writeJsonFile(path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`), {
    proposalId: accepted.id,
    status: 'accepted',
    reviewer: accepted.reviewer,
    reason: accepted.reason,
    decidedAt: now,
    suggestedLink: accepted.suggestedLink,
  })
  files.push(path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`))
  return {
    registryRoot: paths.root,
    proposal: accepted,
    proposalFile: bridgeProposalFile(paths, accepted.id),
    files,
  }
}

export async function runBridgeReject(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposal = await readBridgeProposal(paths, input.proposalId)
  if (!proposal) {
    throw new Error(`Bridge proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('bridge-reject requires --reviewer <name>.')
  }
  if (!input.reason?.trim()) {
    throw new Error('bridge-reject requires --reason <reason>.')
  }
  const now = new Date().toISOString()
  const rejected: BridgeProposal = {
    ...proposal,
    status: 'rejected',
    reviewer: input.reviewer.trim(),
    reviewedAt: now,
    reason: input.reason.trim(),
    updatedAt: now,
  }
  await writeJsonFile(bridgeProposalFile(paths, rejected.id), rejected)
  return {
    registryRoot: paths.root,
    proposal: rejected,
    proposalFile: bridgeProposalFile(paths, rejected.id),
    files: [bridgeProposalFile(paths, rejected.id)],
  }
}

function resolveRegistryPaths(registryRoot: string): RegistryPaths {
  const root = path.resolve(registryRoot)
  return {
    root,
    registryDirectory: path.join(root, 'registry'),
    registryFile: path.join(root, 'registry', 'wikis.json'),
    profilesDirectory: path.join(root, 'registry', 'profiles'),
    profileProposalsDirectory: path.join(root, 'registry', 'profiles', 'proposals'),
    profileDecisionsDirectory: path.join(root, 'registry', 'profiles', 'decisions'),
    classificationPackagesDirectory: path.join(root, 'registry', 'classification', 'packages'),
    routingProposalsDirectory: path.join(root, 'registry', 'routing', 'proposals'),
    routingDecisionsDirectory: path.join(root, 'registry', 'routing', 'decisions'),
    bridgesDirectory: path.join(root, 'registry', 'bridges'),
    bridgeProposalsDirectory: path.join(root, 'registry', 'bridges', 'proposals'),
    bridgeDecisionsDirectory: path.join(root, 'registry', 'bridges', 'decisions'),
    wikisDirectory: path.join(root, 'wikis'),
    inboxDirectory: path.join(root, 'raw', 'inbox'),
    rawObjectsDirectory: path.join(root, 'raw', 'objects'),
    intakeItemsDirectory: path.join(root, 'system', 'intake', 'items'),
    intakeSpoolDirectory: path.join(root, 'system', 'intake', 'spool'),
    intakeEvents: path.join(root, 'system', 'intake', 'events.jsonl'),
    intakeLocksDirectory: path.join(root, 'system', 'intake', 'locks'),
    atlasIndexDirectory: path.join(root, 'system', 'index'),
    ragDirectory: path.join(root, 'system', 'rag'),
    queryLog: path.join(root, 'registry', 'query-log.jsonl'),
  }
}

async function readRegistryState(paths: RegistryPaths): Promise<WikiRegistryState> {
  const state = await readJsonFile<WikiRegistryState>(paths.registryFile, { version: 1, wikis: [] })
  return {
    version: 1,
    wikis: state.wikis.map(normalizeWikiProfile),
  }
}

type SourceRole = 'ordinary' | 'source-map'

type SourceSummary = {
  kind: RouteProposal['source']['kind']
  sha256: string | null
  title: string
  excerpt: string
  searchText: string
  sourceRole: SourceRole
}

async function classifyRouteProposal(
  paths: RegistryPaths,
  source: SourceSummary,
  candidates: RouteCandidate[],
  wikis: WikiRegistryEntry[],
  intakeItem: IntakeItem | null,
): Promise<Pick<RouteProposal,
  | 'decisionType'
  | 'recommendedWikiId'
  | 'confidence'
  | 'evidence'
  | 'risks'
  | 'humanQuestions'
  | 'newWikiProposalId'
  | 'parkReason'
  | 'rejectReason'
  | 'bridgeSuggestions'
  | 'classificationPolicy'
> & { intakeItemId: string | null }> {
  const top = candidates[0]
  const second = candidates[1]
  const criteria = evaluateNewWikiCriteria(source, candidates)
  const strongMatch = Boolean(top && top.score >= 2)
  const weakMatch = Boolean(top && top.score > 0 && top.score < 2)
  const bridgeSuggestions = buildBridgeSuggestions(candidates)

  if (source.kind === 'unknown') {
    return {
      decisionType: 'reject_source',
      recommendedWikiId: null,
      confidence: 'medium',
      evidence: [`Unsupported or unreadable source: ${source.title}`],
      risks: ['Ingesting unsupported input would create low-quality or unverifiable pages.'],
      humanQuestions: ['Should this source be converted to Markdown before routing?'],
      newWikiProposalId: null,
      parkReason: null,
      rejectReason: 'Unsupported or unreadable source; convert first or reject.',
      bridgeSuggestions: [],
      classificationPolicy: buildClassificationPolicy(criteria),
      intakeItemId: intakeItem?.id ?? null,
    }
  }

  if (source.sourceRole === 'source-map') {
    return {
      decisionType: 'park_for_later',
      recommendedWikiId: top?.wikiId ?? null,
      confidence: 'low',
      evidence: [
        `Source appears to be an index/source-map: ${source.title}.`,
        top ? `Nearest existing wiki is ${top.wikiId} with score ${top.score}.` : 'No existing wiki candidate was available.',
      ],
      risks: [
        'Index/source-map files can duplicate or amplify linked documents instead of adding new primary evidence.',
        'Review whether this should be used as navigation context, split into referenced sources, or rejected.',
      ],
      humanQuestions: [
        'Should this source be parked as navigation context instead of ingested as ordinary knowledge?',
        top ? `If accepted anyway, should ${top.wikiId} own it?` : 'Which wiki, if any, should own this source map?',
      ],
      newWikiProposalId: null,
      parkReason: 'Index/source-map source should not silently become canonical wiki knowledge.',
      rejectReason: null,
      bridgeSuggestions: [],
      classificationPolicy: buildClassificationPolicy(criteria),
      intakeItemId: intakeItem?.id ?? null,
    }
  }

  if (strongMatch) {
    return {
      decisionType: bridgeSuggestions.length > 0 ? 'bridge_existing_wikis' : 'route_existing',
      recommendedWikiId: top!.wikiId,
      confidence: top!.score >= 4 ? 'high' : 'medium',
      evidence: [
        `Best existing wiki: ${top!.wikiId} with score ${top!.score}.`,
        `Matched terms: ${top!.matchedTerms.join(', ') || 'none'}.`,
      ],
      risks: bridgeSuggestions.length > 0
        ? ['Source appears cross-domain; avoid duplicating canonical pages across wikis.']
        : [],
      humanQuestions: [
        `Confirm ingest into ${top!.wikiId}, or override with another wiki id.`,
        'If the source is cross-domain, should a bridge be created instead of duplicating content?',
      ],
      newWikiProposalId: null,
      parkReason: null,
      rejectReason: null,
      bridgeSuggestions,
      classificationPolicy: buildClassificationPolicy(criteria),
      intakeItemId: intakeItem?.id ?? null,
    }
  }

  if (weakMatch && criteria.satisfied.length < criteria.requiredThreshold) {
    return {
      decisionType: 'park_for_later',
      recommendedWikiId: top!.wikiId,
      confidence: 'low',
      evidence: [
        `Only weak existing wiki match: ${top!.wikiId} with score ${top!.score}.`,
        `New-wiki criteria satisfied: ${criteria.satisfied.length}/${criteria.requiredThreshold}.`,
      ],
      risks: ['Forcing a weak match may pollute the target wiki; creating a wiki from one source may be too narrow.'],
      humanQuestions: [
        `Is this merely adjacent to ${top!.wikiId}, or should it wait until more related sources exist?`,
      ],
      newWikiProposalId: null,
      parkReason: 'Weak existing match and insufficient evidence for a durable new wiki boundary.',
      rejectReason: null,
      bridgeSuggestions,
      classificationPolicy: buildClassificationPolicy(criteria),
      intakeItemId: intakeItem?.id ?? null,
    }
  }

  const profileSuggestion = await createProfileProposalForSource(paths, {
    source,
    sourcePath: intakeItem ? path.join(paths.root, intakeItem.currentPath) : source.title,
    intakeItemId: intakeItem?.id ?? null,
    routeProposalId: null,
    existingWikis: wikis,
    candidates,
  })

  return {
    decisionType: 'create_new_wiki',
    recommendedWikiId: null,
    confidence: 'low',
    evidence: [
      `No strong existing wiki match; top score is ${top?.score ?? 0}.`,
      `New-wiki criteria satisfied: ${criteria.satisfied.join('; ') || 'none'}.`,
    ],
    risks: [
      'Human must confirm expected future corpus and profile boundaries before creating the wiki.',
      second ? `Nearest alternatives were ${top?.wikiId ?? 'none'} and ${second.wikiId}; avoid unnecessary split if they share retrieval intent.` : 'No comparable existing wiki was available.',
    ],
    humanQuestions: profileSuggestion.proposal.reviewQuestions,
    newWikiProposalId: profileSuggestion.proposal.id,
    parkReason: null,
    rejectReason: null,
    bridgeSuggestions,
    classificationPolicy: buildClassificationPolicy(criteria),
    intakeItemId: intakeItem?.id ?? null,
  }
}

async function createProfileProposalForSource(paths: RegistryPaths, input: {
  source: SourceSummary
  sourcePath: string
  intakeItemId: string | null
  routeProposalId: string | null
  existingWikis: WikiRegistryEntry[]
  candidates: RouteCandidate[]
}): Promise<ProfileProposalResult> {
  const now = new Date().toISOString()
  const criteria = evaluateNewWikiCriteria(input.source, input.candidates)
  const id = normalizeWikiId(suggestWikiId(input.source.title, input.source.searchText))
  const proposedWiki = buildDraftWikiProfile({
    paths,
    id,
    title: titleFromId(id),
    source: input.source,
    existingWikis: input.existingWikis,
    now,
  })
  const proposal: ProfileProposal = {
    id: `profile-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
    status: 'proposed',
    kind: 'create_wiki',
    targetWikiId: proposedWiki.id,
    proposedWiki,
    rationale: 'The source did not strongly match existing wiki profiles. Create a new wiki only if this is a durable governance boundary, not a one-off topic.',
    evidence: [
      `Source title: ${input.source.title}`,
      `Top candidate score: ${input.candidates[0]?.score ?? 0}`,
      `Proposed core scope: ${proposedWiki.scopeCore.join(', ')}`,
    ],
    risks: [
      'Too broad a profile will capture unrelated future sources.',
      'Too narrow a profile will fragment the atlas and increase bridge/query overhead.',
    ],
    reviewQuestions: [
      'Do you expect repeated future sources in this domain?',
      'Is this better represented as a topic inside an existing wiki?',
      'Which terms should be explicitly out-of-scope to prevent drift?',
    ],
    sourceIntakeItemId: input.intakeItemId,
    sourceRouteProposalId: input.routeProposalId,
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

function evaluateNewWikiCriteria(source: SourceSummary, candidates: RouteCandidate[]): ProfileProposal['newWikiCriteria'] {
  const topScore = candidates[0]?.score ?? 0
  const tokens = [...new Set(tokenize(source.searchText))]
  const satisfied = [
    topScore < 1 ? 'No existing wiki has a strong semantic/profile fit.' : null,
    tokens.length >= 8 ? 'Source exposes enough distinct terminology to draft a boundary.' : null,
    source.excerpt.length >= 160 ? 'Source has enough content to evaluate retrieval intent and scope.' : null,
    topScore === 0 ? 'Forcing this into an existing wiki would create taxonomy pollution risk.' : null,
    source.kind !== 'unknown' ? 'Source format is ingestible after human route/profile confirmation.' : null,
  ].filter((value): value is string => Boolean(value))
  const all = [
    'No existing wiki has a strong semantic/profile fit.',
    'Source exposes enough distinct terminology to draft a boundary.',
    'Source has enough content to evaluate retrieval intent and scope.',
    'Forcing this into an existing wiki would create taxonomy pollution risk.',
    'Source format is ingestible after human route/profile confirmation.',
  ]
  return {
    satisfied,
    missing: all.filter((criterion) => !satisfied.includes(criterion)),
    requiredThreshold: 3,
  }
}

function buildClassificationPolicy(criteria: ProfileProposal['newWikiCriteria']): RouteProposal['classificationPolicy'] {
  return {
    summary: 'Route into an existing wiki only on a strong fit; create a new wiki only when at least three boundary criteria are satisfied; otherwise park/reject instead of forcing a category.',
    newWikiRequiredSatisfied: criteria.satisfied,
    newWikiRequiredMissing: criteria.missing,
    requiredSatisfiedCount: criteria.satisfied.length,
    requiredThreshold: criteria.requiredThreshold,
  }
}

async function buildClassificationPackage(paths: RegistryPaths, input: {
  routeProposalId: string
  intakeItemId: string | null
  source: SourceSummary
  candidates: RouteCandidate[]
  wikis: WikiRegistryEntry[]
  recommendedWikiId: string | null
  confidence: 'low' | 'medium' | 'high'
  bridgeSuggestions: RouteProposal['bridgeSuggestions']
  newWikiProposalId: string | null
  decisionType: RouteDecisionType
  createdAt: string
}): Promise<ClassificationPackage> {
  const topics = buildPackageTopics(input.source)
  const tags = [...new Set(topics.map((topic) => topic.slug))]
  const relatedPages = await collectRelatedPages(input.source, input.wikis)
  const primaryWiki = input.recommendedWikiId
    ? {
        wikiId: input.recommendedWikiId,
        confidence: input.confidence,
        rationale: `Primary ownership candidate from route decision type ${input.decisionType}.`,
      }
    : null
  const topScore = input.candidates[0]?.score ?? 0
  const secondaryWikis = input.candidates
    .filter((candidate) => candidate.wikiId !== input.recommendedWikiId && candidate.score > 0)
    .slice(0, 4)
    .map((candidate) => ({
      wikiId: candidate.wikiId,
      relation: (candidate.score >= 2 && topScore - candidate.score <= 1 ? 'co-relevant' : candidate.score >= 2 ? 'bridge' : 'possible-secondary') as ClassificationPackage['secondaryWikis'][number]['relation'],
      confidence: scoreToConfidence(candidate.score),
      rationale: candidate.score >= 2
        ? `Also matched strongly (${candidate.score}); treat as secondary/bridge context, not silent duplicate ownership.`
        : `Weak secondary signal (${candidate.score}); show only as context unless human confirms.`,
    }))

  return {
    id: `class-${input.createdAt.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
    routeProposalId: input.routeProposalId,
    intakeItemId: input.intakeItemId,
    humanReviewRequired: true,
    sourceTitle: input.source.title,
    primaryWiki,
    secondaryWikis,
    topics,
    tags,
    relatedPages,
    linkSuggestions: buildLinkSuggestions(primaryWiki?.wikiId ?? null, relatedPages, input.bridgeSuggestions),
    proposedOperations: buildClassificationOperations(paths, input.routeProposalId, input.intakeItemId, input.newWikiProposalId, input.decisionType, input.recommendedWikiId),
    reviewQuestions: [
      'Is the primary wiki the correct owner, or should this be parked/rejected?',
      'Are the secondary wiki relationships bridge context or true co-relevant domains?',
      'Which proposed topics/tags should become canonical taxonomy proposals after ingest?',
      'Which related-page/link suggestions are real enough to keep?',
    ],
    createdAt: input.createdAt,
  }
}

function buildPackageTopics(source: SourceSummary): ClassificationPackage['topics'] {
  const terms = extractClassificationTopicTerms(source, 8)
  const [root, ...children] = terms
  if (!root) {
    return []
  }
  const rootTopic = {
    slug: root,
    title: titleFromId(root),
    level: 1,
    parentSlug: null,
    confidence: 0.72,
    rationale: 'Top source term; candidate broad topic for human review.',
  }
  return [
    rootTopic,
    ...children.map((term, index) => ({
      slug: term,
      title: titleFromId(term),
      level: index < 3 ? 2 : 3,
      parentSlug: root,
      confidence: Number(Math.max(0.48, 0.68 - index * 0.03).toFixed(2)),
      rationale: 'Derived from source title/content terms; candidate internal taxonomy, not canonical until accepted.',
    })),
  ]
}

function extractClassificationTopicTerms(source: SourceSummary, limit: number): string[] {
  return [
    ...extractTitleTopicCandidates(source.title),
    ...extractProfileTerms(source.searchText, source.title, limit * 2).filter(isUsefulClassificationTopicToken),
  ]
    .filter((term) => term.length > 0)
    .filter((term, index, terms) => terms.indexOf(term) === index)
    .slice(0, limit)
}

function extractTitleTopicCandidates(title: string): string[] {
  const candidates = new Set<string>()
  const normalizedTitle = normalizeClassificationTitle(title)

  for (const segment of splitClassificationTitleSegments(normalizedTitle)) {
    addTitleTopicCandidate(candidates, segment)

    for (const subSegment of segment.split(/\b(?:for|using|with|to|and|of)\b/gi)) {
      addTitleTopicCandidate(candidates, subSegment)
    }

    const forMatch = segment.match(/^(.+?)\s+for\s+(.+)$/i)
    if (forMatch) {
      addTitleTopicCandidate(candidates, forMatch[1] ?? '')
      addTitleTopicCandidate(candidates, forMatch[2] ?? '')
    }
  }

  return [...candidates]
}

function normalizeClassificationTitle(title: string): string {
  return title
    .replace(/^#+\s*/, '')
    .replace(/\bcomplete official documentation\b/gi, '')
    .replace(/\bofficial documentation\b/gi, '')
    .replace(/\bsaved[_\s-]*date\b.*$/gi, '')
    .replace(/\bsource[_\s-]*url\b.*$/gi, '')
    .replace(/[“”"']/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitClassificationTitleSegments(title: string): string[] {
  return title
    .split(/\s+(?:[-–—:])\s+|[:：]/g)
    .map((segment) => segment.replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `))
    .flatMap((segment) => segment.split(/\s{2,}/g))
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function addTitleTopicCandidate(candidates: Set<string>, rawPhrase: string): void {
  const slug = slugifyClassificationTopic(rawPhrase)
  if (isUsefulClassificationTopic(slug)) {
    candidates.add(slug)
  }
}

function slugifyClassificationTopic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !CLASSIFICATION_TOPIC_NOISE_WORDS.has(token))
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isUsefulClassificationTopic(slug: string): boolean {
  const tokens = slug.split('-').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 5) {
    return false
  }
  if (tokens.length === 1) {
    return isUsefulClassificationTopicToken(tokens[0])
  }
  return tokens.some(isUsefulClassificationTopicToken)
}

function isUsefulClassificationTopicToken(token: string): boolean {
  if (CLASSIFICATION_TOPIC_NOISE_WORDS.has(token)) {
    return false
  }
  if (/^\d+$/.test(token)) {
    return false
  }
  if (/^[\p{L}\p{N}]+$/u.test(token) && token.length < 3) {
    return false
  }
  return true
}

async function collectRelatedPages(source: SourceSummary, wikis: WikiRegistryEntry[]): Promise<ClassificationPackage['relatedPages']> {
  const sourceTokens = new Set(tokenize(source.searchText))
  const related: ClassificationPackage['relatedPages'] = []

  for (const wiki of wikis) {
    let pages: Awaited<ReturnType<typeof loadIndexedPages>> = []
    try {
      pages = await loadIndexedPages(wiki.knowledgeRoot)
    } catch {
      continue
    }
    for (const page of pages) {
      const pageTokens = tokenize(`${page.title} ${page.target}`)
      const overlap = pageTokens.filter((token) => sourceTokens.has(token))
      if (overlap.length === 0) {
        continue
      }
      related.push({
        wikiId: wiki.id,
        target: page.target,
        title: page.title,
        relationship: overlap.length >= 3 ? 'same-topic' : 'supporting-context',
        confidence: Number(Math.min(0.9, 0.45 + overlap.length * 0.12).toFixed(2)),
        rationale: `Matched related page terms: ${[...new Set(overlap)].slice(0, 6).join(', ')}.`,
      })
    }
  }

  return related
    .sort((left, right) => right.confidence - left.confidence || left.wikiId.localeCompare(right.wikiId) || left.target.localeCompare(right.target))
    .slice(0, 8)
}

function buildLinkSuggestions(
  primaryWikiId: string | null,
  relatedPages: ClassificationPackage['relatedPages'],
  bridgeSuggestions: RouteProposal['bridgeSuggestions'],
): ClassificationPackage['linkSuggestions'] {
  const relatedLinks = relatedPages.slice(0, 6).map((page) => ({
    wikiId: page.wikiId,
    link: primaryWikiId && page.wikiId !== primaryWikiId
      ? `llm-wiki://${page.wikiId}/${page.target}`
      : `[[${page.target}|${page.title}]]`,
    target: page.target,
    rationale: page.rationale,
  }))
  const bridgeLinks = bridgeSuggestions.map((bridge) => ({
    wikiId: bridge.toWikiId,
    link: `llm-wiki://${bridge.toWikiId}/<section>/<slug>`,
    target: '<section>/<slug>',
    rationale: bridge.rationale,
  }))
  return [...relatedLinks, ...bridgeLinks]
}

function buildClassificationOperations(
  paths: RegistryPaths,
  routeProposalId: string,
  intakeItemId: string | null,
  newWikiProposalId: string | null,
  decisionType: RouteDecisionType,
  recommendedWikiId: string | null,
): ClassificationPackage['proposedOperations'] {
  const operations: ClassificationPackage['proposedOperations'] = []
  if (recommendedWikiId) {
    operations.push({
      action: 'accept-primary-route',
      command: `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(routeProposalId)} --wiki ${shellQuote(recommendedWikiId)} --reviewer <name>`,
      requiresHumanApproval: true,
      rationale: 'Accept the primary wiki route and ingest only after the human confirms the proposal shown by the agent.',
    })
  }
  if (newWikiProposalId) {
    operations.push({
      action: 'accept-new-profile',
      command: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(newWikiProposalId)} --reviewer <name>`,
      requiresHumanApproval: true,
      rationale: 'Create the proposed wiki/profile only if the boundary is durable enough.',
    })
  }
  if (decisionType === 'bridge_existing_wikis') {
    operations.push({
      action: 'review-bridge',
      command: 'llm-wiki bridge-list <registryRoot>',
      requiresHumanApproval: true,
      rationale: 'After route acceptance, bridge proposals should be reviewed before cross-wiki links are written.',
    })
  }
  operations.push({
    action: 'review-taxonomy',
    command: 'llm-wiki taxonomy-list <acceptedKnowledgeRoot>',
    requiresHumanApproval: true,
    rationale: 'Topics/tags in this package are candidate internal taxonomy; canonicalization needs taxonomy review.',
  })
  if (intakeItemId) {
    operations.push({
      action: 'park',
      command: `llm-wiki intake-park ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
      requiresHumanApproval: true,
      rationale: 'Use when the source is plausible but not ready for durable routing/profile creation.',
    }, {
      action: 'reject',
      command: `llm-wiki intake-reject ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
      requiresHumanApproval: true,
      rationale: 'Use when the source should not enter this atlas or should be converted first.',
    })
  }
  return operations
}

function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 4) return 'high'
  if (score >= 2) return 'medium'
  return 'low'
}

function buildDraftWikiProfile(input: {
  paths: RegistryPaths
  id: string
  title: string
  source: SourceSummary
  existingWikis: WikiRegistryEntry[]
  now: string
}): WikiRegistryEntry {
  const core = extractProfileTerms(input.source.searchText, input.source.title, 8)
  const adjacent = input.existingWikis
    .flatMap((wiki) => profilePositiveTerms(wiki).filter((term) => input.source.searchText.toLowerCase().includes(term)))
    .slice(0, 6)
  return {
    id: input.id,
    title: input.title,
    knowledgeRoot: path.join(input.paths.wikisDirectory, input.id),
    scopeCore: core,
    scopeAdjacent: [...new Set(adjacent)],
    scope: [...new Set([...core, ...adjacent])],
    outOfScope: [
      'single-source parking without expected future corpus',
      'materials whose primary retrieval intent belongs to another registered wiki',
    ],
    aliases: [input.source.title].filter(Boolean),
    conceptAliases: core.slice(0, 4).map((term) => ({ canonical: term, aliases: [] })),
    granularity: defaultGranularityPolicy(),
    exampleAccept: [input.source.title],
    exampleReject: [],
    profileNotes: [
      'Drafted from one source; human should tighten scope before accepting.',
      'Wiki boundaries are governance/retrieval boundaries, not ordinary folder categories.',
    ],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function normalizeWikiProfile(wiki: WikiRegistryEntry): WikiRegistryEntry {
  const scopeCore = normalizeStringList(wiki.scopeCore ?? wiki.scope ?? [])
  const scopeAdjacent = normalizeStringList(wiki.scopeAdjacent ?? [])
  return {
    ...wiki,
    scopeCore,
    scopeAdjacent,
    scope: [...new Set([...scopeCore, ...scopeAdjacent, ...(wiki.scope ?? [])])],
    outOfScope: normalizeStringList(wiki.outOfScope ?? []),
    aliases: normalizeStringList(wiki.aliases ?? []),
    conceptAliases: wiki.conceptAliases ?? [],
    granularity: wiki.granularity ?? defaultGranularityPolicy(),
    exampleAccept: wiki.exampleAccept ?? [],
    exampleReject: wiki.exampleReject ?? [],
    profileNotes: wiki.profileNotes ?? [],
  }
}

function defaultGranularityPolicy(): WikiRegistryEntry['granularity'] {
  return {
    preferredLevel: 'field',
    splitWhen: [
      'independent terminology',
      'different retrieval intent',
      'different source quality/review standards',
      'expected recurring corpus',
      'high pollution risk if forced into an existing wiki',
    ],
    doNotSplitWhen: [
      'only a technique variant',
      'mostly queried together with an existing wiki',
      'shares the same sources and concepts',
      'single source with no expected follow-up corpus',
    ],
  }
}


async function updateIntakeItemAfterRouteAcceptance(
  paths: RegistryPaths,
  proposal: RouteProposal,
  ingestResult: IngestJobResult,
  wikiId: string,
  reviewer: string,
): Promise<void> {
  const item = proposal.intakeItemId
    ? await readIntakeItem(paths, proposal.intakeItemId)
    : await findIntakeItemByRouteProposal(paths, proposal.id)
  if (!item) {
    return
  }

  const terminalFailure = ingestResult.status === 'failed_terminal' || ingestResult.status === 'failed_retryable' || ingestResult.status === 'rejected'
  const taxonomyProposalSlugs = ingestResult.taxonomyFiles.map(taxonomySlugFromFile).filter((slug): slug is string => Boolean(slug))
  const status: IntakeItemStatus = terminalFailure
    ? 'blocked'
    : ingestResult.status === 'needs_review' || ingestResult.status === 'partial' || taxonomyProposalSlugs.length > 0
      ? 'taxonomy_review'
      : 'ingested'

  await updateIntakeItem(paths, item.id, (current) => ({
    ...current,
    status,
    targetWikiId: wikiId,
    routeProposalId: proposal.id,
    taxonomyProposalSlugs,
    wikiPages: ingestResult.writtenFiles,
    managedRawArchive: ingestResult.archivePath ?? ingestResult.retainedPath ?? ingestResult.rejectedPath,
    reviewRequired: status === 'taxonomy_review',
    lastError: terminalFailure ? `ingest status: ${ingestResult.status}` : null,
    reviewer,
    updatedAt: new Date().toISOString(),
  }), 'route-accepted')
}

async function createBridgeProposalsAfterRouteAccept(
  paths: RegistryPaths,
  proposal: RouteProposal,
  ingestResult: IngestJobResult,
  primaryWikiId: string,
): Promise<string[]> {
  const sourcePageFile = ingestResult.writtenFiles.find((filePath) => filePath.replace(/\\/g, '/').includes('/wiki/sources/')) ?? null
  const sourcePageTarget = sourcePageFile ? `sources/${path.basename(sourcePageFile, '.md')}` : null
  const files: string[] = []
  const now = new Date().toISOString()
  const secondaryWikis = proposal.classificationPackage.secondaryWikis
    .filter((secondary) => secondary.wikiId !== primaryWikiId && (secondary.relation === 'bridge' || secondary.relation === 'co-relevant'))

  for (const secondary of secondaryWikis) {
    const bridgeProposal: BridgeProposal = {
      id: `bridge-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
      status: 'proposed',
      routeProposalId: proposal.id,
      fromWikiId: primaryWikiId,
      toWikiId: secondary.wikiId,
      sourcePageTarget,
      sourcePageFile,
      suggestedLink: `llm-wiki://${secondary.wikiId}/<section>/<slug>`,
      rationale: secondary.rationale,
      reviewer: null,
      reviewedAt: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
    }
    const file = bridgeProposalFile(paths, bridgeProposal.id)
    await writeJsonFile(file, bridgeProposal)
    files.push(file)
  }

  return files
}

async function readBridgeProposals(paths: RegistryPaths): Promise<BridgeProposal[]> {
  const entries = await readdir(paths.bridgeProposalsDirectory, { withFileTypes: true })
  const proposals: BridgeProposal[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const proposal = await readJsonFile<BridgeProposal | null>(path.join(paths.bridgeProposalsDirectory, entry.name), null)
    if (proposal) {
      proposals.push(proposal)
    }
  }
  return proposals.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

async function readBridgeProposal(paths: RegistryPaths, proposalId: string): Promise<BridgeProposal | null> {
  return readJsonFile<BridgeProposal | null>(bridgeProposalFile(paths, proposalId), null)
}

function bridgeProposalFile(paths: RegistryPaths, proposalId: string): string {
  return path.join(paths.bridgeProposalsDirectory, `${proposalId}.json`)
}

async function appendBridgeLinkToSourcePage(sourcePageFile: string, suggestedLink: string, rationale: string): Promise<void> {
  const content = await readFile(sourcePageFile, 'utf8')
  if (content.includes(suggestedLink)) {
    return
  }
  const section = [
    '',
    '## Cross-wiki bridges',
    `- ${suggestedLink} — ${rationale}`,
    '',
  ].join('\n')
  await appendFile(sourcePageFile, section, 'utf8')
}

async function readIntakeItems(paths: RegistryPaths): Promise<IntakeItem[]> {
  const entries = await readdir(paths.intakeItemsDirectory, { withFileTypes: true })
  const items: IntakeItem[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const item = await readJsonFile<IntakeItem | null>(path.join(paths.intakeItemsDirectory, entry.name), null)
    if (item) {
      items.push(item)
    }
  }
  return items
}

async function readIntakeItem(paths: RegistryPaths, itemId: string): Promise<IntakeItem | null> {
  return readJsonFile<IntakeItem | null>(intakeItemFile(paths, itemId), null)
}

async function updateIntakeItem(
  paths: RegistryPaths,
  itemId: string,
  update: (item: IntakeItem) => IntakeItem,
  eventType: string,
): Promise<IntakeItem> {
  const item = await readIntakeItem(paths, itemId)
  if (!item) {
    throw new Error(`Intake item does not exist: ${itemId}`)
  }
  const updated = update(item)
  await writeIntakeItem(paths, updated)
  await appendIntakeEvent(paths, {
    type: eventType,
    itemId,
    status: updated.status,
    updatedAt: updated.updatedAt,
  })
  return updated
}

async function writeIntakeItem(paths: RegistryPaths, item: IntakeItem): Promise<void> {
  await writeJsonFile(intakeItemFile(paths, item.id), item)
}

function intakeItemFile(paths: RegistryPaths, itemId: string): string {
  return path.join(paths.intakeItemsDirectory, `${itemId}.json`)
}

async function appendIntakeEvent(paths: RegistryPaths, value: unknown): Promise<void> {
  await appendJsonLine(paths.intakeEvents, value)
}

async function findIntakeItemBySource(paths: RegistryPaths, source: string): Promise<IntakeItem | null> {
  const sourcePath = path.resolve(source)
  const items = await readIntakeItems(paths)
  return items.find((item) => path.resolve(paths.root, item.currentPath) === sourcePath) ?? null
}

async function findIntakeItemByRouteProposal(paths: RegistryPaths, proposalId: string): Promise<IntakeItem | null> {
  const items = await readIntakeItems(paths)
  return items.find((item) => item.routeProposalId === proposalId) ?? null
}

function compareIntakeItems(left: IntakeItem, right: IntakeItem): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function isTerminalIntakeStatus(status: IntakeItemStatus): boolean {
  return status === 'completed' || status === 'rejected' || status === 'parked'
}

function profileProposalFile(paths: RegistryPaths, proposalId: string): string {
  return path.join(paths.profileProposalsDirectory, `${proposalId}.json`)
}

function markProfileProposalReviewed(
  proposal: ProfileProposal,
  status: 'accepted' | 'rejected',
  reviewer: string,
  reason: string | null,
): ProfileProposal {
  const now = new Date().toISOString()
  return {
    ...proposal,
    status,
    reviewer: reviewer.trim(),
    reviewedAt: now,
    reason,
    updatedAt: now,
  }
}

async function readRouteDecisions(paths: RegistryPaths): Promise<Array<RouteDecision & { proposal: RouteProposal | null }>> {
  const entries = await readdir(paths.routingDecisionsDirectory, { withFileTypes: true })
  const decisions: Array<RouteDecision & { proposal: RouteProposal | null }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const decision = await readJsonFile<RouteDecision | null>(path.join(paths.routingDecisionsDirectory, entry.name), null)
    if (!decision) {
      continue
    }
    decisions.push({
      ...decision,
      proposal: await readJsonFile<RouteProposal | null>(path.join(paths.routingProposalsDirectory, `${decision.proposalId}.json`), null),
    })
  }
  return decisions
}

function profilePositiveTerms(wiki: WikiRegistryEntry): string[] {
  return [...new Set([
    wiki.id,
    wiki.title,
    ...wiki.aliases,
    ...wiki.scope,
    ...wiki.scopeCore,
    ...wiki.scopeAdjacent,
    ...wiki.conceptAliases.flatMap((group) => [group.canonical, ...group.aliases]),
    ...wiki.exampleAccept,
  ].flatMap(tokenize))]
}

function buildBridgeSuggestions(candidates: RouteCandidate[]): RouteProposal['bridgeSuggestions'] {
  const strong = candidates.filter((candidate) => candidate.score >= 2)
  if (strong.length < 2) {
    return []
  }
  const [primary, ...others] = strong
  return others.slice(0, 2).map((candidate) => ({
    fromWikiId: primary.wikiId,
    toWikiId: candidate.wikiId,
    rationale: `Both wikis scored strongly (${primary.wikiId}: ${primary.score}, ${candidate.wikiId}: ${candidate.score}); prefer explicit bridge links over duplicated canonical pages.`,
  }))
}

function suggestWikiId(title: string, searchText: string): string {
  const titleTokens = tokenize(title).filter((token) => token.length > 2)
  const tokens = titleTokens.length > 0 ? titleTokens : extractProfileTerms(searchText, title, 3)
  return normalizeWikiId(tokens.slice(0, 3).join('-') || 'new-wiki')
}

function extractProfileTerms(searchText: string, title: string, limit: number): string[] {
  const titleTokens = tokenize(title)
  const counts = new Map<string, number>()
  for (const token of [...titleTokens, ...tokenize(searchText)]) {
    if (token.length < 3) {
      continue
    }
    counts.set(token, (counts.get(token) ?? 0) + (titleTokens.includes(token) ? 3 : 1))
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, limit)
}

function detectRouteSourceKind(fileName: string): RouteProposal['source']['kind'] {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
    return 'local-file'
  }
  return 'unknown'
}

async function hashIntakeSource(sourcePath: string): Promise<string> {
  const metadata = await stat(sourcePath)
  const hash = createHash('sha256')

  if (metadata.isDirectory()) {
    await hashDirectory(sourcePath, sourcePath, hash)
  } else {
    hash.update(await readFile(sourcePath))
  }

  return hash.digest('hex')
}

async function hashDirectory(root: string, current: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(current, entry.name)
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/')
    hash.update(relativePath)
    if (entry.isDirectory()) {
      await hashDirectory(root, absolutePath, hash)
    } else if (entry.isFile()) {
      hash.update(await readFile(absolutePath))
    }
  }
}

function taxonomySlugFromFile(filePath: string): string | null {
  if (!filePath.endsWith('.json')) {
    return null
  }
  return path.basename(filePath, '.json')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function summarizeSource(input: string): Promise<SourceSummary> {
  if (/^[a-z]+:\/\//i.test(input.trim())) {
    return {
      kind: 'url',
      sha256: null,
      title: input.trim(),
      excerpt: input.trim(),
      searchText: input.trim(),
      sourceRole: 'ordinary',
    }
  }

  const absolutePath = path.resolve(input)
  try {
    const content = await readFile(absolutePath, 'utf8')
    return {
      kind: 'local-file',
      sha256: createHash('sha256').update(content).digest('hex'),
      title: extractTitle(content) || path.basename(absolutePath),
      excerpt: normalizeWhitespace(content).slice(0, 1200),
      searchText: `${path.basename(absolutePath)}\n${content}`,
      sourceRole: inferRegistrySourceRole(absolutePath, content),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EISDIR') {
      return {
        kind: 'unknown',
        sha256: null,
        title: path.basename(absolutePath),
        excerpt: absolutePath,
        searchText: absolutePath,
        sourceRole: 'ordinary',
      }
    }
  }

  const entries = await readdir(absolutePath, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)).join('\n')
  return {
    kind: 'directory',
    sha256: createHash('sha256').update(names).digest('hex'),
    title: path.basename(absolutePath),
    excerpt: names.slice(0, 1200),
    searchText: `${path.basename(absolutePath)}\n${names}`,
    sourceRole: 'ordinary',
  }
}

function inferRegistrySourceRole(filePath: string, content: string): SourceRole {
  const basename = path.basename(filePath, path.extname(filePath)).toLowerCase()
  const title = extractTitle(content) || basename
  const titleLooksLikeIndex = /^(index|contents?|目录|索引)$/i.test(title.trim()) || /(?:index|contents?|目录|索引)/i.test(title.trim()) || basename === 'index'
  if (!titleLooksLikeIndex) {
    return 'ordinary'
  }

  if (basename === 'index' && /(?:index|contents?|目录|索引)/i.test(title.trim())) {
    return 'source-map'
  }

  const body = content.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '')
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return 'source-map'
  }

  const navigationLines = lines.filter((line) => /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\|.+\|$/.test(line) || /\[[^\]]+\]\([^)]*\)/.test(line) || /\[\[[^\]]+\]\]/.test(line) || /`[^`]+\.(?:md|markdown|txt)`/.test(line))
  return navigationLines.length / lines.length >= 0.5 ? 'source-map' : 'ordinary'
}

function rankWikis(searchText: string, wikis: WikiRegistryEntry[]): RouteCandidate[] {
  const sourceTokens = new Set(tokenize(searchText))

  return wikis
    .map((wiki) => {
      const normalizedWiki = normalizeWikiProfile(wiki)
      const positiveTerms = profilePositiveTerms(normalizedWiki)
      const negativeTerms = [...new Set(normalizedWiki.outOfScope.flatMap(tokenize))]
      const matchedTerms = positiveTerms.filter((term) => sourceTokens.has(term))
      const negativeMatches = negativeTerms.filter((term) => sourceTokens.has(term))
      const score = Math.max(0, matchedTerms.length + matchedTerms.filter((term) => normalizedWiki.scopeCore.flatMap(tokenize).includes(term)).length * 0.5 - negativeMatches.length)
      return {
        wikiId: normalizedWiki.id,
        title: normalizedWiki.title,
        knowledgeRoot: normalizedWiki.knowledgeRoot,
        score: Number(score.toFixed(2)),
        matchedTerms,
        negativeMatches,
        rationale: matchedTerms.length > 0
          ? `Matched registry scope terms: ${matchedTerms.join(', ')}${negativeMatches.length > 0 ? `; out-of-scope terms reduced score: ${negativeMatches.join(', ')}` : ''}.`
          : 'No explicit scope terms matched; included as a fallback candidate for human review.',
      }
    })
    .sort((left, right) => right.score - left.score || left.wikiId.localeCompare(right.wikiId))
}

function buildRegistryAnswer(question: string, results: QueryRegistryWikiResult[]): string {
  const answered = results.filter((entry) => entry.result && entry.result.citations.length > 0)
  if (answered.length === 0) {
    const errors = results.filter((entry) => entry.error).map((entry) => `${entry.wikiId}: ${entry.error}`).join('; ')
    return `I searched ${results.length} registered wiki(s) for "${question}" but found no cited answer.${errors ? ` Query errors: ${errors}` : ''}`
  }

  return answered.map((entry) => [
    `## ${entry.title} (${entry.wikiId})`,
    entry.result!.answer,
    `Citations: ${entry.result!.citations.map((citation) => `${entry.wikiId}:${citation.target}`).join(', ')}`,
  ].join('\n')).join('\n\n')
}

function tokenize(text: string): string[] {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
}

function extractTitle(content: string): string | null {
  const heading = content.match(/^#\s+(.+)$/m)
  return heading?.[1]?.trim() || null
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeWikiId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

function titleFromId(id: string): string {
  return id.split(/[-_.]+/g).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || id
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]
}

async function ensureTextFile(filePath: string, initialValue: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  if (await exists(filePath)) {
    return
  }
  await writeFile(filePath, initialValue, 'utf8')
}

async function ensureJsonFile<T>(filePath: string, initialValue: T): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  if (await exists(filePath)) {
    return
  }
  await writeJsonFile(filePath, initialValue)
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const existing = await exists(filePath) ? await readFile(filePath, 'utf8') : ''
  const needsNewline = existing.length > 0 && !existing.endsWith('\n')
  await writeFile(filePath, `${existing}${needsNewline ? '\n' : ''}${JSON.stringify(value)}\n`, 'utf8')
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}
