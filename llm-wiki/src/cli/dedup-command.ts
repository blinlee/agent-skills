import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  contentDedupIndexPath,
  createContentDedupStore,
  type ContentDedupCandidate,
  type ContentDedupMergeResult,
  type ContentDedupPendingDecision,
  type ContentDedupRecord,
  type ContentDedupScanCandidate,
  type ContentDedupStats,
  type ContentDedupUserDecision,
} from '../intake/content-dedup-store.js'
import { backfillContentDedupIndex, type ContentDedupBackfillResult } from '../intake/content-dedup-backfill.js'
import { loadContentDedupEmbedding } from '../intake/content-dedup-embedding.js'
import { hashSourceMetadata } from '../intake/fingerprint.js'
import { classifySource, isSupportedSourceKind } from '../intake/source-discovery.js'
import { stripManagedRawFrontmatter } from '../intake/raw-store.js'
import { runBuildIndex, type BuildIndexResult } from '../index/wiki-index.js'
import { parseMarkdownSource } from '../parsers/markdown.js'
import { parseTextSource } from '../parsers/text.js'
import type { ParsedArtifact } from '../parsers/base.js'
import { removeWikiPageFile } from '../wiki/page-writer.js'
import { appendWikiLog, updateWikiIndex } from '../wiki/index-log.js'

export type DedupPendingCommandResult = {
  knowledgeRoot: string
  pending: ContentDedupPendingDecision[]
}

export type DedupRecordSummary = {
  docHash: string
  sourceIdentity: string
  sourceUrl: string | null
  title: string
  pageId: string
  chunkCount: number
  embeddingProvider?: string
  embeddingModel?: string
  embeddingDims?: number
}

export type DedupCandidateSummary = {
  record: DedupRecordSummary
  reason: ContentDedupCandidate['reason']
  similarity: number | null
}

export type DedupCheckCommandResult = {
  knowledgeRoot: string
  input: string
  sourceKind: string
  title: string
  docHash: string
  embeddingProvider: string | null
  embeddingModel: string | null
  embeddingDiagnostic: string | null
  exactMatch: DedupRecordSummary | null
  semanticMatch: DedupCandidateSummary | null
  candidates: DedupCandidateSummary[]
}

export type DedupStatsCommandResult = {
  knowledgeRoot: string
  stats: ContentDedupStats
}

export type DedupScanCommandResult = {
  knowledgeRoot: string
  candidates: Array<{
    left: DedupRecordSummary
    right: DedupRecordSummary
    reason: ContentDedupScanCandidate['reason']
    similarity: number | null
  }>
}

export type DedupBackfillCommandResult = ContentDedupBackfillResult

export type DedupDecideCommandInput = {
  knowledgeRoot: string
  decisionId: string
  decision: ContentDedupUserDecision
  reviewer: string
  note?: string
}

export type DedupDecideCommandResult = {
  knowledgeRoot: string
  decision: ContentDedupPendingDecision
}

export type DedupMergeCommandInput = {
  knowledgeRoot: string
  source: string
  target: string
  confirm: string | boolean
  reviewer: string
  note?: string
}

export type DedupMergeCommandResult = {
  knowledgeRoot: string
  merge: {
    source: DedupRecordSummary
    target: DedupRecordSummary
    mergedPageId: string
    updatedRecordCount: number
  }
  removedPageFile: string
  removedIndexEntry: string
  index: BuildIndexResult
}

export type DedupCommandResult =
  | DedupPendingCommandResult
  | DedupDecideCommandResult
  | DedupCheckCommandResult
  | DedupStatsCommandResult
  | DedupScanCommandResult
  | DedupBackfillCommandResult
  | DedupMergeCommandResult

export async function runDedupPendingCommand(input: { knowledgeRoot: string }): Promise<DedupPendingCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  return {
    knowledgeRoot,
    pending: await store.listPendingDecisions(),
  }
}

export async function runDedupCheckCommand(input: { knowledgeRoot: string; source: string }): Promise<DedupCheckCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const parsedArtifact = await parseDedupCheckArtifact(input.source)
  const sourceIdentity = path.resolve(input.source)
  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  let check = await store.check({
    sourceIdentity,
    sourceKind: parsedArtifact.sourceKind,
    sourceUrl: null,
    title: parsedArtifact.title,
    content: parsedArtifact.content,
  })
  const embedding = await loadContentDedupEmbedding(parsedArtifact.content)
  if (embedding.vector) {
    check = await store.check({
      sourceIdentity,
      sourceKind: parsedArtifact.sourceKind,
      sourceUrl: null,
      title: parsedArtifact.title,
      content: parsedArtifact.content,
      embeddingVector: embedding.vector,
      embeddingProvider: embedding.provider,
      embeddingModel: embedding.model,
    })
  }

  return {
    knowledgeRoot,
    input: input.source,
    sourceKind: parsedArtifact.sourceKind,
    title: parsedArtifact.title,
    docHash: check.docHash,
    embeddingProvider: embedding.provider,
    embeddingModel: embedding.model,
    embeddingDiagnostic: embedding.diagnostic,
    exactMatch: check.exactMatch ? summarizeDedupRecord(check.exactMatch) : null,
    semanticMatch: check.semanticMatch ? summarizeDedupCandidate(check.semanticMatch) : null,
    candidates: check.candidates.map(summarizeDedupCandidate),
  }
}

export async function runDedupStatsCommand(input: { knowledgeRoot: string }): Promise<DedupStatsCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  return {
    knowledgeRoot,
    stats: await store.stats(),
  }
}

export async function runDedupScanCommand(input: { knowledgeRoot: string }): Promise<DedupScanCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  return {
    knowledgeRoot,
    candidates: (await store.scanCandidates()).map((candidate) => ({
      left: summarizeDedupRecord(candidate.left),
      right: summarizeDedupRecord(candidate.right),
      reason: candidate.reason,
      similarity: candidate.similarity,
    })),
  }
}

export async function runDedupBackfillCommand(input: { knowledgeRoot: string }): Promise<DedupBackfillCommandResult> {
  return backfillContentDedupIndex({ knowledgeRoot: path.resolve(input.knowledgeRoot) })
}

export async function runDedupDecideCommand(input: DedupDecideCommandInput): Promise<DedupDecideCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  return {
    knowledgeRoot,
    decision: await store.resolvePendingDecision({
      id: input.decisionId,
      decision: input.decision,
      reviewer: input.reviewer,
      note: input.note,
    }),
  }
}

export async function runDedupMergeCommand(input: DedupMergeCommandInput): Promise<DedupMergeCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  if (input.confirm !== true && input.confirm !== 'merge') {
    throw new Error('dedup merge requires --confirm merge')
  }
  if (!input.reviewer) {
    throw new Error('dedup merge requires --reviewer <name>')
  }

  const store = createContentDedupStore(contentDedupIndexPath(knowledgeRoot))
  const merge = await store.mergeRecords({
    source: input.source,
    target: input.target,
    reviewer: input.reviewer,
    note: input.note,
  })
  const removedPageFile = sourcePageFileForPageId(merge.source.pageId)
  const removedIndexEntry = dedupSourceIndexEntry(merge.source)

  await removeWikiPageFile(knowledgeRoot, removedPageFile)
  await updateWikiIndex(knowledgeRoot, { removeEntries: [removedIndexEntry] })
  await appendWikiLog(knowledgeRoot, `合并重复来源页：${merge.source.pageId} -> ${merge.target.pageId}，审核人：${input.reviewer}`)
  const index = await runBuildIndex({ knowledgeRoot })

  return {
    knowledgeRoot,
    merge: summarizeDedupMerge(merge),
    removedPageFile,
    removedIndexEntry,
    index,
  }
}

export async function runDedupCommand(args: Record<string, unknown>): Promise<DedupCommandResult> {
  const subcommand = typeof args.subcommand === 'string' ? args.subcommand : 'pending'
  const knowledgeRoot = String(args.knowledgeRoot ?? '')
  if (subcommand === 'pending') {
    return runDedupPendingCommand({ knowledgeRoot })
  }
  if (subcommand === 'check') {
    return runDedupCheckCommand(args as { knowledgeRoot: string; source: string })
  }
  if (subcommand === 'stats') {
    return runDedupStatsCommand({ knowledgeRoot })
  }
  if (subcommand === 'scan') {
    return runDedupScanCommand({ knowledgeRoot })
  }
  if (subcommand === 'backfill') {
    return runDedupBackfillCommand({ knowledgeRoot })
  }
  if (subcommand === 'decide') {
    return runDedupDecideCommand(args as unknown as DedupDecideCommandInput)
  }
  if (subcommand === 'merge') {
    return runDedupMergeCommand(args as unknown as DedupMergeCommandInput)
  }
  throw new Error(`unknown dedup subcommand: ${subcommand}`)
}

export function runDedupFromArgv(knowledgeRoot: string, args: string[]): Promise<DedupCommandResult> {
  const [subcommand = 'pending', ...rest] = args
  if (subcommand === 'pending') {
    return runDedupPendingCommand({ knowledgeRoot })
  }

  if (subcommand === 'check') {
    const [source] = rest
    if (!source) {
      throw new Error('usage: llm-wiki dedup <knowledgeRoot> check <sourcePath>')
    }
    return runDedupCheckCommand({ knowledgeRoot, source })
  }

  if (subcommand === 'stats') {
    return runDedupStatsCommand({ knowledgeRoot })
  }

  if (subcommand === 'scan') {
    return runDedupScanCommand({ knowledgeRoot })
  }

  if (subcommand === 'backfill') {
    return runDedupBackfillCommand({ knowledgeRoot })
  }

  if (subcommand === 'decide') {
    const [decisionId, ...flagArgs] = rest
    if (!decisionId) {
      throw new Error('usage: llm-wiki dedup <knowledgeRoot> decide <decisionId> --decision <skip|update|keep_both|ingest> --reviewer <name> [--note <note>]')
    }
    const flags = parseCliFlags(flagArgs)
    const decision = normalizeDedupUserDecision(firstFlag(flags, 'decision'))
    const reviewer = firstFlag(flags, 'reviewer')
    if (!decision) {
      throw new Error('dedup decide requires --decision <skip|update|keep_both|ingest>')
    }
    if (!reviewer) {
      throw new Error('dedup decide requires --reviewer <name>')
    }
    return runDedupDecideCommand({
      knowledgeRoot,
      decisionId,
      decision,
      reviewer,
      note: firstFlag(flags, 'note'),
    })
  }

  if (subcommand === 'merge') {
    const [source, target, ...flagArgs] = rest
    if (!source || !target) {
      throw new Error('usage: llm-wiki dedup <knowledgeRoot> merge <sourceRef> <targetRef> --confirm merge --reviewer <name> [--note <note>]')
    }
    const flags = parseCliFlags(flagArgs)
    const reviewer = firstFlag(flags, 'reviewer')
    if (!reviewer) {
      throw new Error('dedup merge requires --reviewer <name>')
    }
    return runDedupMergeCommand({
      knowledgeRoot,
      source,
      target,
      confirm: firstFlag(flags, 'confirm') ?? '',
      reviewer,
      note: firstFlag(flags, 'note'),
    })
  }

  throw new Error(`unknown dedup subcommand: ${subcommand}`)
}

function normalizeDedupUserDecision(value: string | undefined): ContentDedupUserDecision | null {
  return value === 'skip' || value === 'update' || value === 'keep_both' || value === 'ingest' ? value : null
}

async function parseDedupCheckArtifact(source: string): Promise<ParsedArtifact<'md' | 'txt'>> {
  const sourceKind = classifySource(source)
  if (!isSupportedSourceKind(sourceKind) || (sourceKind !== 'md' && sourceKind !== 'txt')) {
    throw new Error('dedup check currently supports local Markdown or text files')
  }

  const sourceIdentity = path.resolve(source)
  const sourceId = hashSourceMetadata({ sourceKind, sourceIdentity }).slice(0, 16)
  const content = stripManagedRawFrontmatter(await readFile(sourceIdentity, 'utf8'))
  const input = {
    sourceId,
    path: sourceIdentity,
    content,
  }

  return sourceKind === 'md'
    ? parseMarkdownSource(input)
    : parseTextSource(input)
}

function summarizeDedupCandidate(candidate: ContentDedupCandidate): DedupCandidateSummary {
  return {
    record: summarizeDedupRecord(candidate.record),
    reason: candidate.reason,
    similarity: candidate.similarity,
  }
}

function summarizeDedupRecord(record: ContentDedupRecord): DedupRecordSummary {
  return {
    docHash: record.docHash,
    sourceIdentity: record.sourceIdentity,
    sourceUrl: record.sourceUrl,
    title: record.title,
    pageId: record.pageId,
    chunkCount: record.chunkCount,
    ...(record.embeddingProvider ? { embeddingProvider: record.embeddingProvider } : {}),
    ...(record.embeddingModel ? { embeddingModel: record.embeddingModel } : {}),
    ...(record.embeddingDims ? { embeddingDims: record.embeddingDims } : {}),
  }
}

function summarizeDedupMerge(result: ContentDedupMergeResult): DedupMergeCommandResult['merge'] {
  return {
    source: summarizeDedupRecord(result.source),
    target: summarizeDedupRecord(result.target),
    mergedPageId: result.mergedPageId,
    updatedRecordCount: result.updatedRecordCount,
  }
}

function sourcePageFileForPageId(pageId: string): string {
  if (!/^sources\/[a-z0-9-]+$/.test(pageId)) {
    throw new Error(`dedup merge can only remove source wiki pages, got: ${pageId}`)
  }
  return path.posix.join('wiki', `${pageId}.md`)
}

function dedupSourceIndexEntry(record: ContentDedupRecord): string {
  return `- [[${record.pageId}|${record.title}]]`
}

function parseCliFlags(args: string[]): Record<string, string[]> {
  const flags: Record<string, string[]> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg?.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`)
    }
    const key = arg.slice(2)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for flag: ${arg}`)
    }
    flags[key] = [...(flags[key] ?? []), value]
    index += 1
  }
  return flags
}

function firstFlag(flags: Record<string, string[]>, key: string): string | undefined {
  return flags[key]?.[0]
}
