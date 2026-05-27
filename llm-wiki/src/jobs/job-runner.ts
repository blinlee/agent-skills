import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { analyzeArtifact } from '../compile/analysis'
import { generateKnowledgeChanges } from '../compile/generation'
import { loadConfig } from '../config'
import { persistReviewItems, removeStaleReviewFiles } from '../governance/review'
import { applyTaxonomyEffects } from '../governance/taxonomy'
import {
  createEmptyLifecycleState,
  retainReviewableIntake,
  stageIntakeFile,
  stageNormalizedArtifact,
  archiveStagedFile,
  rejectIntakeFile,
  type IntakeLifecycleState,
} from '../intake/lifecycle'
import { createDedupStore, type DedupDecision, type DedupEntry, type OutputPageSnapshot } from '../intake/dedup-store'
import { hashFileLike, hashParsedArtifactForDedup, hashSourceMetadata } from '../intake/fingerprint'
import { classifySource, isSupportedSourceKind, type DiscoveredSourceKind } from '../intake/source-discovery'
import { createJobStore } from './job-store'
import { parseMarkdownSource } from '../parsers/markdown'
import { parseRepoSource } from '../parsers/repo'
import { parseTextSource } from '../parsers/text'
import { parseUrlSource, type CleanedUrlContent } from '../parsers/url'
import type { ParsedArtifact } from '../parsers/base'
import { ensureKnowledgeRootLayout } from '../paths'
import type { JobStatus, SourceKind } from '../types'
import { stripManagedRawFrontmatter } from '../intake/raw-store'
import { updateWikiIndex } from '../wiki/index-log'
import { buildKnowledgeOutputManifest, removeWikiPageFile, restoreWikiPageSnapshot, writeKnowledgeChanges } from '../wiki/page-writer'
import { applySourceSemanticLinks, pruneMissingSourceSemanticLinks } from '../wiki/semantic-links'

export type RunIngestJobInput = {
  knowledgeRoot: string
  input: string
}

export type IngestJobResult = {
  jobId: string
  status: JobStatus
  sourceKind: DiscoveredSourceKind
  dedupDecision: DedupDecision | null
  writtenFiles: string[]
  reviewFiles: string[]
  taxonomyFiles: string[]
  stagedPath: string | null
  archivePath: string | null
  rejectedPath: string | null
  retainedPath: string | null
}

type JobDetails = Record<string, unknown>

export async function runIngestJob(input: RunIngestJobInput): Promise<IngestJobResult> {
  const config = loadConfig({
    knowledgeRoot: input.knowledgeRoot,
    jobStorePath: path.join(path.resolve(input.knowledgeRoot), 'system', 'jobs', 'jobs.json'),
  })

  await ensureKnowledgeRootLayout(config.knowledgeRoot)

  const jobStore = createJobStore(config.jobStorePath)
  const dedupStore = createDedupStore(path.join(config.knowledgeRoot, 'system', 'dedup', 'manifest.json'))
  const sourceKind = classifySource(input.input)
  const lifecycle = createEmptyLifecycleState()
  const writtenFiles: string[] = []
  const reviewFiles: string[] = []
  const taxonomyFiles: string[] = []
  const jobId = randomUUID()

  await jobStore.save({
    id: jobId,
    status: 'queued',
    sourceKind,
    sourceRef: input.input,
    details: {
      step: 'queued',
    },
  })

  const persistResult = async (status: JobStatus, dedupDecision: DedupDecision | null, details: JobDetails = {}) => {
    await jobStore.updateStatus(jobId, status, {
      input: input.input,
      sourceKind,
      writtenFiles,
      reviewFiles,
      taxonomyFiles,
      stagedPath: lifecycle.stagedPath,
      archivePath: lifecycle.archivePath,
      rejectedPath: lifecycle.rejectedPath,
      retainedPath: lifecycle.retainedPath,
      dedupDecision,
      ...details,
    })

    return {
      jobId,
      status,
      sourceKind,
      dedupDecision,
      writtenFiles: [...writtenFiles],
      reviewFiles: [...reviewFiles],
      taxonomyFiles: [...taxonomyFiles],
      stagedPath: lifecycle.stagedPath,
      archivePath: lifecycle.archivePath,
      rejectedPath: lifecycle.rejectedPath,
      retainedPath: lifecycle.retainedPath,
    } satisfies IngestJobResult
  }

  try {
    await jobStore.updateStatus(jobId, 'running', { step: 'discover-source', input: input.input, sourceKind })

    if (!isSupportedSourceKind(sourceKind)) {
      lifecycle.rejectedPath = await rejectIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind: 'unknown',
      })

      return persistResult('rejected', null, {
        step: 'rejected',
        reason: 'unsupported-source-kind',
      })
    }

    const sourceIdentity = normalizeSourceIdentity(sourceKind, input.input)
    const preparedSource = await prepareSourceForDedup({
      sourceKind,
      input: input.input,
      sourceId: buildStableSourceId(sourceKind, sourceIdentity),
      stagedPath: lifecycle.stagedPath,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })
    const { fingerprint } = preparedSource
    const previousDedupEntry = await dedupStore.get(sourceIdentity)
    const dedupDecision = await dedupStore.shouldCompile({
      identity: sourceIdentity,
      sourceKind,
      fingerprint,
    })

    await jobStore.updateStatus(jobId, 'running', {
      step: 'dedup-check',
      sourceIdentity,
      fingerprint,
      dedupDecision,
    })

    if (dedupDecision.action === 'skip') {
      return persistResult('completed', dedupDecision, {
        step: 'dedup-skip',
        sourceIdentity,
        fingerprint,
        skipped: true,
      })
    }

    if (sourceKind === 'md' || sourceKind === 'txt') {
      lifecycle.stagedPath = await stageIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind,
      })
    }

    await jobStore.updateStatus(jobId, 'running', {
      step: 'parse-source',
      sourceIdentity,
      fingerprint,
      dedupDecision,
      stagedPath: lifecycle.stagedPath,
    })

    const parsedArtifact = preparedSource.parsedArtifact ?? await parseSource({
      sourceKind,
      input: input.input,
      sourceId: buildStableSourceId(sourceKind, sourceIdentity),
      stagedPath: lifecycle.stagedPath,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })

    if (!lifecycle.stagedPath && (sourceKind === 'url' || sourceKind === 'repo')) {
      lifecycle.stagedPath = await stageNormalizedArtifact({
        knowledgeRoot: config.knowledgeRoot,
        jobId,
        sourceKind,
        sourceRef: input.input,
        title: parsedArtifact.title,
        content: parsedArtifact.content,
      })
    }

    const analysis = await analyzeArtifact(parsedArtifact)
    const otherDedupEntries = (await dedupStore.list()).filter((entry) => entry.identity !== sourceIdentity)
    let generation = await generateKnowledgeChanges(analysis)
    const collisionFreeSourceSlug = resolveCollisionFreeSourceSlug(
      generation.sourcePage.slug,
      parsedArtifact.id,
      otherDedupEntries,
    )

    if (collisionFreeSourceSlug !== generation.sourcePage.slug) {
      generation = await generateKnowledgeChanges(analysis, { sourceSlug: collisionFreeSourceSlug })
    }

    const writeResult = await writeKnowledgeChanges({
      knowledgeRoot: config.knowledgeRoot,
      sourcePage: generation.sourcePage,
      entityPages: generation.entityPages,
      conceptPages: generation.conceptPages,
      synthesisSuggestions: generation.synthesisSuggestions,
      logEntry: generation.logMutations.map((mutation) => mutation.value).join('\n'),
      indexEntries: generation.indexMutations.map((mutation) => mutation.value),
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
    })
    const semanticLinkResult = await applySourceSemanticLinks({
      knowledgeRoot: config.knowledgeRoot,
      source: {
        slug: generation.sourcePage.slug,
        title: generation.sourcePage.title,
      },
    })
    const staleDerivedReconciliation = await reconcileStaleDerivedOutputs({
      knowledgeRoot: config.knowledgeRoot,
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
      currentOutputManifest: writeResult.outputManifest,
      otherEntries: otherDedupEntries,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })
    const semanticPruneResult = await pruneMissingSourceSemanticLinks(config.knowledgeRoot)
    writtenFiles.push(
      ...writeResult.writtenFiles,
      ...semanticLinkResult.writtenFiles,
      ...staleDerivedReconciliation.writtenFiles,
      ...semanticPruneResult.writtenFiles,
    )

    const reviewArtifacts = [
      ...generation.reviewEffects.map((effect, index) => ({
        id: `${parsedArtifact.id}-review-${index + 1}`,
        artifactId: parsedArtifact.id,
        type: effect.kind,
        issueSummary: effect.reason,
        severity: effect.severity,
        reason: effect.reason,
        status: 'open',
        relatedSources: [parsedArtifact.sourceRef],
        relatedPages: buildReviewRelatedPages(generation),
        evidence: effect.evidence ?? [effect.reason],
        confidence: effect.confidence,
        candidate: effect.candidate,
        suggestedActions: effect.suggestedActions ?? buildDefaultReviewSuggestedActions(effect.kind),
      })),
    ]

    if (reviewArtifacts.length > 0) {
      const reviewResult = await persistReviewItems(config.knowledgeRoot, reviewArtifacts)
      reviewFiles.push(...reviewResult.files)
    }

    const currentReviewManifest = reviewFiles.map((filePath) => path.relative(config.knowledgeRoot, filePath))
    await removeStaleReviewFiles(
      config.knowledgeRoot,
      previousDedupEntry?.lastOutputManifest?.reviewFiles ?? [],
      currentReviewManifest,
    )

    if (generation.taxonomyEffects.length > 0) {
      const taxonomyResult = await applyTaxonomyEffects(config.knowledgeRoot, {
        topicProposals: generation.taxonomyEffects.map((effect) => ({
          name: effect.title,
          confidence: effect.confidence,
          rationale: effect.rationale,
          sources: [effect.source],
        })),
      })
      taxonomyFiles.push(...taxonomyResult.files)
    }

    const finalStatus = resolveFinalStatus(generation.reviewEffects.length > 0 || generation.taxonomyEffects.length > 0)
    const outputManifest = {
      ...writeResult.outputManifest,
      reviewFiles: currentReviewManifest,
    }

    if (finalStatus === 'completed') {
      if (lifecycle.stagedPath) {
        lifecycle.archivePath = await archiveStagedFile(config.knowledgeRoot, lifecycle.stagedPath)
        lifecycle.stagedPath = null
      }
    } else if (lifecycle.stagedPath) {
      lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath)
    }

    if (shouldRecordSuccessfulManifest(finalStatus)) {
      await dedupStore.recordSuccess({
        identity: sourceIdentity,
        sourceKind,
        fingerprint,
        jobId,
        outputManifest,
      })
    }

    return persistResult(finalStatus, dedupDecision, {
      step: 'completed',
      sourceIdentity,
      fingerprint,
      reviewTriggerCount: analysis.reviewTriggers.length,
      entityCount: analysis.candidateEntities.length,
      conceptCount: analysis.candidateConcepts.length,
    })
  } catch (error) {
    if (!lifecycle.rejectedPath && isLocalFileCandidate(sourceKind, input.input)) {
      lifecycle.rejectedPath = await rejectIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind: isSupportedSourceKind(sourceKind) ? sourceKind : 'unknown',
        stagedPath: lifecycle.stagedPath,
      })
      lifecycle.stagedPath = null
    }

    return persistResult(resolveFailureStatus(sourceKind, error), null, {
      step: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function buildReviewRelatedPages(generation: Awaited<ReturnType<typeof generateKnowledgeChanges>>): string[] {
  return [
    `sources/${generation.sourcePage.slug}`,
    ...generation.entityPages.map((page) => `entities/${page.slug}`),
    ...generation.conceptPages.map((page) => `concepts/${page.slug}`),
  ]
}

function buildDefaultReviewSuggestedActions(kind: string): string[] {
  if (kind === 'low-confidence') {
    return ['Review the low-confidence candidate and approve, merge, rename, or reject it.']
  }

  if (kind === 'semantic-candidate') {
    return ['Review the candidate and approve, merge, rename, or reject it before creating durable wiki semantics.']
  }

  if (kind === 'ambiguous-classification') {
    return ['Resolve the ambiguous classification before promoting it into durable taxonomy or wiki structure.']
  }

  if (kind === 'sparse-artifact') {
    return ['Add more source evidence or mark the artifact as intentionally sparse.']
  }

  return ['Review the item and decide whether it should change durable wiki or taxonomy state.']
}

function shouldRecordSuccessfulManifest(status: JobStatus): boolean {
  return status === 'completed' || status === 'needs_review' || status === 'partial'
}

type DerivedPageOwner = {
  entry: DedupEntry
  snapshot: OutputPageSnapshot
}

async function reconcileStaleDerivedOutputs(input: {
  knowledgeRoot: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>
  otherEntries: DedupEntry[]
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}): Promise<{ writtenFiles: string[] }> {
  const previousManifest = input.previousOutputManifest
  if (!previousManifest) {
    return { writtenFiles: [] }
  }

  const staleDerivedFiles = collectStaleDerivedFiles(previousManifest, input.currentOutputManifest)

  const retainedIndexEntries = new Set(
    input.otherEntries.flatMap((entry) => entry.lastOutputManifest?.indexEntries ?? []),
  )
  const indexEntriesToAdd = new Set<string>()
  const indexEntriesToRemove = new Set<string>()
  const writtenFiles: string[] = []
  const legacySnapshotCache = new Map<string, Promise<OutputPageSnapshot[]>>()

  for (const filePath of staleDerivedFiles) {
    const remainingOwners = await collectDerivedPageOwners({
      entries: input.otherEntries,
      filePath,
      urlFetchTimeoutMs: input.urlFetchTimeoutMs,
      repoSampleLimit: input.repoSampleLimit,
      legacySnapshotCache,
    })

    if (remainingOwners.length === 0) {
      await removeWikiPageFile(input.knowledgeRoot, filePath)
      writtenFiles.push(path.join(path.resolve(input.knowledgeRoot), filePath))
      continue
    }

    const survivor = pickMostRecentSnapshotOwner(remainingOwners)
    writtenFiles.push(await restoreWikiPageSnapshot(input.knowledgeRoot, survivor.snapshot))

    if (survivor.snapshot.indexEntry) {
      indexEntriesToAdd.add(survivor.snapshot.indexEntry)
    }
  }

  const staleIndexEntries = previousManifest.indexEntries.filter(
    (entry) => !input.currentOutputManifest.indexEntries.includes(entry) && !isSourceOwnedIndexEntry(entry),
  )

  for (const entry of staleIndexEntries) {
    if (!retainedIndexEntries.has(entry)) {
      indexEntriesToRemove.add(entry)
    }
  }

  if (indexEntriesToAdd.size > 0 || indexEntriesToRemove.size > 0) {
    writtenFiles.push(await updateWikiIndex(input.knowledgeRoot, {
      addEntries: [...indexEntriesToAdd],
      removeEntries: [...indexEntriesToRemove],
    }))
  }

  return {
    writtenFiles: [...new Set(writtenFiles)],
  }
}

function collectStaleDerivedFiles(
  previousOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
): string[] {
  const previousDerivedFiles = new Set<string>([
    ...previousOutputManifest.pageFiles.filter(isDerivedWikiPage),
    ...(previousOutputManifest.pageSnapshots ?? []).map((snapshot) => snapshot.filePath).filter(isDerivedWikiPage),
  ])

  return [...previousDerivedFiles].filter((filePath) => !currentOutputManifest.pageFiles.includes(filePath))
}

async function collectDerivedPageOwners(input: {
  entries: DedupEntry[]
  filePath: string
  urlFetchTimeoutMs: number
  repoSampleLimit: number
  legacySnapshotCache: Map<string, Promise<OutputPageSnapshot[]>>
}): Promise<DerivedPageOwner[]> {
  const owners = await Promise.all(input.entries.map(async (entry) => {
    const snapshots = await collectEntryPageSnapshots({
      entry,
      urlFetchTimeoutMs: input.urlFetchTimeoutMs,
      repoSampleLimit: input.repoSampleLimit,
      legacySnapshotCache: input.legacySnapshotCache,
    })

    return snapshots
      .filter((snapshot) => snapshot.filePath === input.filePath)
      .map((snapshot) => ({ entry, snapshot }))
  }))

  return owners.flat()
}

async function collectEntryPageSnapshots(input: {
  entry: DedupEntry
  urlFetchTimeoutMs: number
  repoSampleLimit: number
  legacySnapshotCache: Map<string, Promise<OutputPageSnapshot[]>>
}): Promise<OutputPageSnapshot[]> {
  const manifest = input.entry.lastOutputManifest
  if (!manifest) {
    return []
  }

  const snapshots = manifest.pageSnapshots ?? []
  if (snapshots.length > 0) {
    return snapshots
  }

  if (!manifest.pageFiles.some(isDerivedWikiPage)) {
    return []
  }

  const cachedSnapshots = input.legacySnapshotCache.get(input.entry.identity)
  if (cachedSnapshots) {
    return cachedSnapshots
  }

  const reconstructSnapshotsPromise = reconstructLegacyPageSnapshots({
    entry: input.entry,
    urlFetchTimeoutMs: input.urlFetchTimeoutMs,
    repoSampleLimit: input.repoSampleLimit,
  }).catch(() => [])

  input.legacySnapshotCache.set(input.entry.identity, reconstructSnapshotsPromise)
  return reconstructSnapshotsPromise
}

async function reconstructLegacyPageSnapshots(input: {
  entry: DedupEntry
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}): Promise<OutputPageSnapshot[]> {
  const parsedArtifact = await parseSource({
    sourceKind: input.entry.sourceKind,
    input: input.entry.identity,
    sourceId: buildStableSourceId(input.entry.sourceKind, input.entry.identity),
    stagedPath: null,
    urlFetchTimeoutMs: input.urlFetchTimeoutMs,
    repoSampleLimit: input.repoSampleLimit,
  })
  const analysis = await analyzeArtifact(parsedArtifact)
  const generation = await generateKnowledgeChanges(analysis)
  return buildKnowledgeOutputManifest({
    sourcePage: generation.sourcePage,
    entityPages: generation.entityPages,
    conceptPages: generation.conceptPages,
    indexEntries: generation.indexMutations.map((mutation) => mutation.value),
  }).pageSnapshots ?? []
}

function pickMostRecentSnapshotOwner(
  owners: DerivedPageOwner[],
): DerivedPageOwner {
  return [...owners].sort((left, right) => compareCompiledAt(right.entry.lastCompiledAt, left.entry.lastCompiledAt))[0]
}

function compareCompiledAt(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY
  return leftTime - rightTime
}

function isDerivedWikiPage(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('wiki/entities/') || normalized.startsWith('wiki/concepts/')
}

function isSourceOwnedIndexEntry(entry: string): boolean {
  return /^[-*]\s+\[\[sources\/[^|\]]+\|[^\]]+\]\]$/.test(entry.trim())
}

async function parseSource(input: {
  sourceKind: SourceKind
  input: string
  sourceId: string
  stagedPath: string | null
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}) {
  if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
    const readPath = input.stagedPath ?? input.input
    const content = await readFile(readPath, 'utf8')
    const parserInput = {
      sourceId: input.sourceId,
      path: input.input,
      content: stripManagedRawFrontmatter(content),
    }

    return input.sourceKind === 'md'
      ? parseMarkdownSource(parserInput)
      : parseTextSource(parserInput)
  }

  if (input.sourceKind === 'repo') {
    return parseRepoSource({
      sourceId: input.sourceId,
      repoPath: input.input,
      maxSampleFiles: input.repoSampleLimit,
    })
  }

  return parseUrlSource(
    {
      sourceId: input.sourceId,
      url: input.input,
    },
    (url) => fetchCleanedUrlContent(url, input.urlFetchTimeoutMs),
  )
}

async function prepareSourceForDedup(input: {
  sourceKind: SourceKind
  input: string
  sourceId: string
  stagedPath: string | null
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}): Promise<{ fingerprint: string; parsedArtifact: ParsedArtifact | null }> {
  if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
    return {
      fingerprint: await fingerprintSource(input.sourceKind, input.input),
      parsedArtifact: null,
    }
  }

  const parsedArtifact = await parseSource({
    sourceKind: input.sourceKind,
    input: input.input,
    sourceId: input.sourceId,
    stagedPath: input.stagedPath,
    urlFetchTimeoutMs: input.urlFetchTimeoutMs,
    repoSampleLimit: input.repoSampleLimit,
  })

  return {
    fingerprint: hashParsedArtifactForDedup(parsedArtifact),
    parsedArtifact,
  }
}

async function fingerprintSource(sourceKind: SourceKind, source: string): Promise<string> {
  if (sourceKind === 'md' || sourceKind === 'txt') {
    return hashFileLike(await readFile(source))
  }

  if (sourceKind === 'repo') {
    const fileStat = await stat(source)
    return hashSourceMetadata({
      kind: sourceKind,
      identity: normalizeSourceIdentity(sourceKind, source),
      size: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
    })
  }

  return hashSourceMetadata({
    kind: sourceKind,
    identity: normalizeSourceIdentity(sourceKind, source),
  })
}

function normalizeSourceIdentity(sourceKind: SourceKind, source: string): string {
  return sourceKind === 'url' ? source.trim() : path.resolve(source)
}

function buildStableSourceId(sourceKind: SourceKind, sourceIdentity: string): string {
  return hashSourceMetadata({ sourceKind, sourceIdentity }).slice(0, 16)
}

function resolveCollisionFreeSourceSlug(baseSlug: string, artifactId: string, otherEntries: DedupEntry[]): string {
  if (!isSourceSlugOwnedByOtherEntry(baseSlug, otherEntries)) {
    return baseSlug
  }

  const suffix = artifactId.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 8) || 'source'
  const suffixedSlug = `${baseSlug}-${suffix}`

  if (!isSourceSlugOwnedByOtherEntry(suffixedSlug, otherEntries)) {
    return suffixedSlug
  }

  let counter = 2
  while (isSourceSlugOwnedByOtherEntry(`${suffixedSlug}-${counter}`, otherEntries)) {
    counter += 1
  }

  return `${suffixedSlug}-${counter}`
}

function isSourceSlugOwnedByOtherEntry(slug: string, otherEntries: DedupEntry[]): boolean {
  const sourcePagePath = path.posix.join('wiki', 'sources', `${slug}.md`)
  return otherEntries.some((entry) => entry.lastOutputManifest?.pageFiles.includes(sourcePagePath))
}

function resolveFinalStatus(hasReviewTriggers: boolean): JobStatus {
  if (hasReviewTriggers) {
    return 'needs_review'
  }

  return 'completed'
}

function isLocalFileCandidate(sourceKind: DiscoveredSourceKind, source: string): boolean {
  return sourceKind === 'md' || sourceKind === 'txt' || sourceKind === 'unknown'
}

function resolveFailureStatus(sourceKind: DiscoveredSourceKind, error: unknown): JobStatus {
  if (sourceKind === 'url' && isRetryableUrlFailure(error)) {
    return 'failed_retryable'
  }

  return 'failed_terminal'
}

function isRetryableUrlFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const normalizedMessage = message.toLowerCase()
  const retryableFragments = [
    'timeout',
    'timed out',
    'aborterror',
    'fetch failed',
    'network error',
    'networkerror',
    'econnreset',
    'enotfound',
    'eai_again',
    'socket hang up',
  ]

  if (retryableFragments.some((fragment) => normalizedMessage.includes(fragment))) {
    return true
  }

  const statusMatch = normalizedMessage.match(/failed to fetch url source:\s*(\d{3})\b/)
  if (!statusMatch) {
    return false
  }

  const statusCode = Number(statusMatch[1])
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
}

async function fetchCleanedUrlContent(url: string, timeoutMs: number): Promise<CleanedUrlContent> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL source: ${response.status} ${response.statusText}`)
  }

  const body = await response.text()
  const title = decodeHtmlEntities(body.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ?? url)

  return {
    title,
    body: htmlToReadableText(body),
  }
}

function htmlToReadableText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
      .replace(/<(?:br|\/p|\/div|\/section|\/article|\/main|\/header|\/footer|\/nav|\/aside|\/ul|\/ol|\/li|\/table|\/thead|\/tbody|\/tfoot|\/tr|\/td|\/th|\/blockquote|\/pre|\/h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<(?:p|div|section|article|main|header|footer|nav|aside|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n'),
  )
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}
