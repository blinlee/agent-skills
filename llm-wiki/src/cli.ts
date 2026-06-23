#!/usr/bin/env node
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acceptTaxonomyProposal,
  listTaxonomyProposals,
  rejectTaxonomyProposal,
  type AcceptTaxonomyProposalInput,
  type ListTaxonomyProposalsResult,
  type RejectTaxonomyProposalInput,
} from './governance/taxonomy.js'
import { runIngestJob, type IngestJobResult } from './jobs/job-runner.js'
import {
  runDedupCommand,
  runDedupPendingCommand,
  runDedupCheckCommand,
  runDedupStatsCommand,
  runDedupScanCommand,
  runDedupBackfillCommand,
  runDedupDecideCommand,
  runDedupMergeCommand,
  type DedupBackfillCommandResult,
  type DedupCandidateSummary,
  type DedupCheckCommandResult,
  type DedupDecideCommandInput,
  type DedupDecideCommandResult,
  type DedupMergeCommandInput,
  type DedupMergeCommandResult,
  type DedupPendingCommandResult,
  type DedupRecordSummary,
  type DedupScanCommandResult,
  type DedupStatsCommandResult,
} from './cli/dedup-command.js'
import { runStatusCommand, type StatusCommandInput, type StatusCommandResult } from './cli/status-command.js'
import { runBuildIndex, type BuildIndexInput, type BuildIndexResult } from './index/wiki-index.js'
import { runEmbedIndex, type EmbedIndexInput, type EmbedIndexResult } from './retrieval/embed-index.js'
import {
  buildKnowledgeQueryReadiness,
  buildRegistryQueryReadiness,
  type KnowledgeQueryReadinessReport,
  type RegistryQueryReadinessReport,
} from './retrieval/readiness.js'
import { runWikiOverview, type WikiOverviewInput, type WikiOverviewResult } from './retrieval/wiki-overview.js'
import { runLint, type LintCommandInput, type LintCommandResult } from './lint/lint.js'
import { defaultKnowledgeLayout, ensureKnowledgeRootLayout } from './paths.js'
import { runQuery, type QueryCommandInput, type QueryCommandResult } from './query/query.js'
import { runSaveSynthesis, type SaveSynthesisCommandInput, type SaveSynthesisCommandResult } from './query/save-synthesis.js'
import { exportOkfBundle, type ExportOkfBundleInput, type ExportOkfBundleResult } from './okf/export.js'
import { importOkfBundle, type ImportOkfBundleInput, type ImportOkfBundleResult } from './okf/import.js'
import {
  generateOkfDirectoryIndexes,
  type GenerateOkfDirectoryIndexesResult,
} from './okf/directory-index.js'
import {
  backfillIncompleteWikiAssets,
  type BackfillWikiAssetsResult,
} from './maintenance/wiki-assets.js'
import {
  refreshSemanticOverviews,
  type RefreshSemanticOverviewsResult,
} from './wiki/semantic-overviews.js'
import {
  runBridgeIndex,
  runBridgeAccept,
  runBridgeCreateLanding,
  runBridgeList,
  runBridgeReject,
  runBridgeTargets,
  runIntakeComplete,
  runIntakeNext,
  runIntakePark,
  runIntakeReject,
  runIntakeScan,
  runIntakeStatus,
  runProfileAccept,
  runProfileReject,
  runProfileReview,
  runProfileSuggest,
  runQueryRegistry,
  runRegistryAdd,
  runRegistryInit,
  runRegistryList,
  runRoute,
  runRouteAccept,
  runRouteInbox,
  type BridgeIndexResult,
  type BridgeCreateLandingInput,
  type BridgeDecisionInput,
  type BridgeDecisionResult,
  type BridgeListResult,
  type BridgeTargetsInput,
  type BridgeTargetsResult,
  type IntakeCompleteInput,
  type IntakeDecisionResult,
  type IntakeNextResult,
  type IntakeParkInput,
  type IntakeRejectInput,
  type IntakeScanResult,
  type IntakeStatusResult,
  type ProfileDecisionInput,
  type ProfileDecisionResult,
  type ProfileProposalResult,
  type ProfileReviewResult,
  type ProfileSuggestInput,
  type QueryRegistryInput,
  type QueryRegistryResult,
  type RegistryAddInput,
  type RegistryAddResult,
  type RegistryCommandInput,
  type RegistryInitResult,
  type RegistryListResult,
  type RouteAcceptInput,
  type RouteAcceptResult,
  type RouteInboxResult,
  type RouteInput,
  type RouteResult,
} from './registry/registry.js'
import { exists } from './shared/fs.js'
import { createRunCliFromArgv, formatCliResult } from './cli/argv.js'
export {
  runDedupPendingCommand,
  runDedupCheckCommand,
  runDedupStatsCommand,
  runDedupScanCommand,
  runDedupBackfillCommand,
  runDedupDecideCommand,
  runDedupMergeCommand,
  runStatusCommand,
}

export type {
  DedupBackfillCommandResult,
  DedupCandidateSummary,
  DedupCheckCommandResult,
  DedupDecideCommandInput,
  DedupDecideCommandResult,
  DedupMergeCommandInput,
  DedupMergeCommandResult,
  DedupPendingCommandResult,
  DedupRecordSummary,
  DedupScanCommandResult,
  DedupStatsCommandResult,
  StatusCommandInput,
  StatusCommandResult,
}

type CliCommand = {
  name: () => string
  run?: (args: Record<string, unknown>) => Promise<unknown>
}

type Cli = {
  commands: CliCommand[]
}

type CliCommandName =
  | 'init'
  | 'ingest'
  | 'ingest-inbox'
  | 'query'
  | 'query-readiness'
  | 'dedup'
  | 'embed-index'
  | 'export-bundle'
  | 'lint'
  | 'index'
  | 'wiki-overview'
  | 'maintain'
  | 'taxonomy-list'
  | 'taxonomy-accept'
  | 'taxonomy-reject'
  | 'status'
  | 'save-synthesis'
  | 'registry-init'
  | 'registry-add'
  | 'registry-list'
  | 'route'
  | 'route-inbox'
  | 'route-accept'
  | 'bridge-index'
  | 'bridge-list'
  | 'bridge-targets'
  | 'bridge-accept'
  | 'bridge-create-landing'
  | 'bridge-reject'
  | 'query-registry'
  | 'intake-scan'
  | 'intake-status'
  | 'intake-next'
  | 'intake-complete'
  | 'intake-reject'
  | 'intake-park'
  | 'profile-suggest'
  | 'profile-accept'
  | 'profile-reject'
  | 'profile-review'

type CliCommandSpec = {
  name: CliCommandName
  runObjectArgs: (args: Record<string, unknown>) => Promise<unknown>
}

export type InitCommandInput = {
  knowledgeRoot: string
}

export type InitCommandResult = {
  knowledgeRoot: string
  createdDirectories: string[]
}

export type IngestCommandInput = {
  knowledgeRoot: string
  input: string
  qualityPath?: string
  curationPath?: string
  extractEntities?: boolean
  extractKeyInfo?: boolean
  forceRecompile?: boolean
}

export type IngestInboxCommandInput = {
  knowledgeRoot: string
}

export type IngestInboxCommandResult = {
  knowledgeRoot: string
  inboxPath: string
  results: IngestJobResult[]
}

export type QueryReadinessCommandInput = {
  knowledgeRoot: string
}

export type QueryReadinessCommandResult = KnowledgeQueryReadinessReport | RegistryQueryReadinessReport

export type TaxonomyActionCommandInput = {
  knowledgeRoot: string
  slug: string
  reviewer: string
  reason?: string
}

export type TaxonomyActionCommandResult = {
  knowledgeRoot: string
  slug: string
  status: 'accepted' | 'rejected'
  files: string[]
}

export type MaintainCommandInput = {
  knowledgeRoot: string
}

export type MaintainKnowledgeCommandResult = {
  kind: 'knowledge'
  knowledgeRoot: string
  wikiAssets: BackfillWikiAssetsResult
  semanticOverviews: RefreshSemanticOverviewsResult
  okfDirectoryIndexes: GenerateOkfDirectoryIndexesResult
  index: BuildIndexResult
}

export type MaintainRegistryWikiResult = {
  wikiId: string
  title: string
  knowledgeRoot: string
  wikiAssets: BackfillWikiAssetsResult | null
  semanticOverviews: RefreshSemanticOverviewsResult | null
  okfDirectoryIndexes: GenerateOkfDirectoryIndexesResult | null
  index: BuildIndexResult | null
  error: string | null
}

export type MaintainRegistryCommandResult = {
  kind: 'registry'
  registryRoot: string
  status: 'ready' | 'partial'
  wikis: MaintainRegistryWikiResult[]
}

export type MaintainCommandResult = MaintainKnowledgeCommandResult | MaintainRegistryCommandResult

export type WikiOverviewCommandInput = WikiOverviewInput
export type WikiOverviewCommandResult = WikiOverviewResult

export async function runInitCommand(input: InitCommandInput): Promise<InitCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  await ensureKnowledgeRootLayout(knowledgeRoot)

  return {
    knowledgeRoot,
    createdDirectories: [...defaultKnowledgeLayout],
  }
}

export async function runIngestCommand(input: IngestCommandInput): Promise<IngestJobResult> {
  return runIngestJob(input)
}

export async function runIngestInboxCommand(input: IngestInboxCommandInput): Promise<IngestInboxCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  await ensureKnowledgeRootLayout(knowledgeRoot)

  const inboxPath = path.join(knowledgeRoot, 'raw', 'inbox')
  const entries = await readdir(inboxPath, { withFileTypes: true })
  const ingestTargets = entries
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .filter((entry) => !isInboxControlSidecarName(entry.name))
    .map((entry) => path.join(inboxPath, entry.name))
    .sort((left, right) => left.localeCompare(right))
  const results: IngestJobResult[] = []

  for (const target of ingestTargets) {
    results.push(await runIngestCommand({ knowledgeRoot, input: target }))
  }

  return {
    knowledgeRoot,
    inboxPath,
    results,
  }
}

function isInboxControlSidecarName(name: string): boolean {
  return name.endsWith('.curation.json') || name.endsWith('.quality.json')
}

export async function runImportOkfBundleCommand(input: ImportOkfBundleInput): Promise<ImportOkfBundleResult> {
  return importOkfBundle(input)
}

export async function runQueryCommand(input: QueryCommandInput): Promise<QueryCommandResult> {
  return runQuery(input)
}

export async function runEmbedIndexCommand(input: EmbedIndexInput): Promise<EmbedIndexResult> {
  return runEmbedIndex(input)
}

export async function runExportBundleCommand(input: ExportOkfBundleInput): Promise<ExportOkfBundleResult> {
  return exportOkfBundle(input)
}

export async function runLintCommand(input: LintCommandInput): Promise<LintCommandResult> {
  return runLint(input)
}

export async function runBuildIndexCommand(input: BuildIndexInput): Promise<BuildIndexResult> {
  return runBuildIndex(input)
}

export async function runWikiOverviewCommand(input: WikiOverviewCommandInput): Promise<WikiOverviewCommandResult> {
  return runWikiOverview(input)
}

export async function runMaintainCommand(input: MaintainCommandInput): Promise<MaintainCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  if (await isRegistryRoot(knowledgeRoot)) {
    return runMaintainRegistryCommand(knowledgeRoot)
  }

  return runMaintainKnowledgeRoot(knowledgeRoot)
}

async function runMaintainKnowledgeRoot(knowledgeRoot: string): Promise<MaintainKnowledgeCommandResult> {
  const wikiAssets = await backfillIncompleteWikiAssets({ knowledgeRoot })
  const semanticOverviews = await refreshSemanticOverviews({ knowledgeRoot })
  const okfDirectoryIndexes = await generateOkfDirectoryIndexes({ knowledgeRoot })
  const index = await runBuildIndex({ knowledgeRoot })

  return {
    kind: 'knowledge',
    knowledgeRoot,
    wikiAssets,
    semanticOverviews,
    okfDirectoryIndexes,
    index,
  }
}

async function runMaintainRegistryCommand(registryRoot: string): Promise<MaintainRegistryCommandResult> {
  const registry = await runRegistryListCommand({ registryRoot })
  const wikis: MaintainRegistryWikiResult[] = []

  for (const wiki of registry.wikis) {
    try {
      const maintained = await runMaintainKnowledgeRoot(wiki.knowledgeRoot)
      wikis.push({
        wikiId: wiki.id,
        title: wiki.title,
        knowledgeRoot: wiki.knowledgeRoot,
        wikiAssets: maintained.wikiAssets,
        semanticOverviews: maintained.semanticOverviews,
        okfDirectoryIndexes: maintained.okfDirectoryIndexes,
        index: maintained.index,
        error: null,
      })
    } catch (error) {
      wikis.push({
        wikiId: wiki.id,
        title: wiki.title,
        knowledgeRoot: wiki.knowledgeRoot,
        wikiAssets: null,
        semanticOverviews: null,
        okfDirectoryIndexes: null,
        index: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    kind: 'registry',
    registryRoot,
    status: wikis.some((wiki) => wiki.error) ? 'partial' : 'ready',
    wikis,
  }
}

async function isRegistryRoot(root: string): Promise<boolean> {
  return await exists(path.join(root, 'system', 'registry', 'registry.json')) || await exists(path.join(root, 'wikis'))
}

export async function runTaxonomyListCommand(input: { knowledgeRoot: string }): Promise<ListTaxonomyProposalsResult> {
  return listTaxonomyProposals(input.knowledgeRoot)
}

export async function runTaxonomyAcceptCommand(input: TaxonomyActionCommandInput): Promise<TaxonomyActionCommandResult> {
  const result = await acceptTaxonomyProposal(input.knowledgeRoot, {
    slug: input.slug,
    reviewer: input.reviewer,
  } satisfies AcceptTaxonomyProposalInput)
  return {
    knowledgeRoot: path.resolve(input.knowledgeRoot),
    slug: input.slug,
    status: 'accepted',
    files: result.files,
  }
}

export async function runTaxonomyRejectCommand(input: TaxonomyActionCommandInput): Promise<TaxonomyActionCommandResult> {
  const result = await rejectTaxonomyProposal(input.knowledgeRoot, {
    slug: input.slug,
    reviewer: input.reviewer,
    reason: input.reason,
  } satisfies RejectTaxonomyProposalInput)
  return {
    knowledgeRoot: path.resolve(input.knowledgeRoot),
    slug: input.slug,
    status: 'rejected',
    files: result.files,
  }
}

export async function runSaveSynthesisCommand(input: SaveSynthesisCommandInput): Promise<SaveSynthesisCommandResult> {
  return runSaveSynthesis(input)
}

export async function runRegistryInitCommand(input: RegistryCommandInput): Promise<RegistryInitResult> {
  return runRegistryInit(input)
}

export async function runRegistryAddCommand(input: RegistryAddInput): Promise<RegistryAddResult> {
  return runRegistryAdd(input)
}

export async function runRegistryListCommand(input: RegistryCommandInput): Promise<RegistryListResult> {
  return runRegistryList(input)
}

export async function runRouteCommand(input: RouteInput): Promise<RouteResult> {
  return runRoute(input)
}

export async function runRouteInboxCommand(input: RegistryCommandInput): Promise<RouteInboxResult> {
  return runRouteInbox(input)
}

export async function runBridgeIndexCommand(input: RegistryCommandInput): Promise<BridgeIndexResult> {
  return runBridgeIndex(input)
}

export async function runBridgeListCommand(input: RegistryCommandInput): Promise<BridgeListResult> {
  return runBridgeList(input)
}

export async function runBridgeTargetsCommand(input: BridgeTargetsInput): Promise<BridgeTargetsResult> {
  return runBridgeTargets(input)
}

export async function runBridgeAcceptCommand(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  return runBridgeAccept(input)
}

export async function runBridgeCreateLandingCommand(input: BridgeCreateLandingInput): Promise<BridgeDecisionResult> {
  return runBridgeCreateLanding(input)
}

export async function runBridgeRejectCommand(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  return runBridgeReject(input)
}

export async function runRouteAcceptCommand(input: RouteAcceptInput): Promise<RouteAcceptResult> {
  return runRouteAccept(input)
}

export async function runQueryRegistryCommand(input: QueryRegistryInput): Promise<QueryRegistryResult> {
  return runQueryRegistry(input)
}

export async function runIntakeScanCommand(input: RegistryCommandInput): Promise<IntakeScanResult> {
  return runIntakeScan(input)
}

export async function runIntakeStatusCommand(input: RegistryCommandInput): Promise<IntakeStatusResult> {
  return runIntakeStatus(input)
}

export async function runIntakeNextCommand(input: RegistryCommandInput): Promise<IntakeNextResult> {
  return runIntakeNext(input)
}

export async function runIntakeCompleteCommand(input: IntakeCompleteInput): Promise<IntakeDecisionResult> {
  return runIntakeComplete(input)
}

export async function runIntakeRejectCommand(input: IntakeRejectInput): Promise<IntakeDecisionResult> {
  return runIntakeReject(input)
}

export async function runIntakeParkCommand(input: IntakeParkInput): Promise<IntakeDecisionResult> {
  return runIntakePark(input)
}

export async function runProfileSuggestCommand(input: ProfileSuggestInput): Promise<ProfileProposalResult> {
  return runProfileSuggest(input)
}

export async function runProfileAcceptCommand(input: ProfileDecisionInput): Promise<ProfileDecisionResult> {
  return runProfileAccept(input)
}

export async function runProfileRejectCommand(input: ProfileDecisionInput): Promise<ProfileDecisionResult> {
  return runProfileReject(input)
}

export async function runProfileReviewCommand(input: RegistryCommandInput): Promise<ProfileReviewResult> {
  return runProfileReview(input)
}

export async function runQueryReadinessCommand(input: QueryReadinessCommandInput): Promise<QueryReadinessCommandResult> {
  const root = path.resolve(input.knowledgeRoot)
  if (await isRegistryRoot(root)) {
    const registry = await runRegistryListCommand({ registryRoot: root })
    return buildRegistryQueryReadiness({
      registryRoot: root,
      wikis: registry.wikis.map((wiki) => ({
        wikiId: wiki.id,
        title: wiki.title,
        knowledgeRoot: wiki.knowledgeRoot,
      })),
    })
  }
  return buildKnowledgeQueryReadiness({ knowledgeRoot: root })
}

const CLI_COMMAND_SPECS: CliCommandSpec[] = [
  { name: 'init', runObjectArgs: (args) => runInitCommand(args as InitCommandInput) },
  { name: 'ingest', runObjectArgs: (args) => runIngestOrInboxCommand(args as Partial<IngestCommandInput> & IngestInboxCommandInput) },
  { name: 'ingest-inbox', runObjectArgs: (args) => runIngestInboxCommand(args as IngestInboxCommandInput) },
  { name: 'dedup', runObjectArgs: (args) => runDedupCommand(args as Record<string, unknown>) },
  { name: 'query', runObjectArgs: (args) => runQueryCommand(args as QueryCommandInput) },
  { name: 'query-readiness', runObjectArgs: (args) => runQueryReadinessCommand(args as QueryReadinessCommandInput) },
  { name: 'embed-index', runObjectArgs: (args) => runEmbedIndexCommand(args as EmbedIndexInput) },
  { name: 'export-bundle', runObjectArgs: (args) => runExportBundleCommand(args as ExportOkfBundleInput) },
  { name: 'lint', runObjectArgs: (args) => runLintCommand(args as LintCommandInput) },
  { name: 'index', runObjectArgs: (args) => runBuildIndexCommand(args as BuildIndexInput) },
  { name: 'wiki-overview', runObjectArgs: (args) => runWikiOverviewCommand(args as WikiOverviewCommandInput) },
  { name: 'maintain', runObjectArgs: (args) => runMaintainCommand(args as MaintainCommandInput) },
  { name: 'taxonomy-list', runObjectArgs: (args) => runTaxonomyListCommand(args as { knowledgeRoot: string }) },
  { name: 'taxonomy-accept', runObjectArgs: (args) => runTaxonomyAcceptCommand(args as TaxonomyActionCommandInput) },
  { name: 'taxonomy-reject', runObjectArgs: (args) => runTaxonomyRejectCommand(args as TaxonomyActionCommandInput) },
  { name: 'status', runObjectArgs: (args) => runStatusCommand(args as StatusCommandInput) },
  { name: 'save-synthesis', runObjectArgs: (args) => runSaveSynthesisCommand(args as SaveSynthesisCommandInput) },
  { name: 'registry-init', runObjectArgs: (args) => runRegistryInitCommand(args as RegistryCommandInput) },
  { name: 'registry-add', runObjectArgs: (args) => runRegistryAddCommand(args as RegistryAddInput) },
  { name: 'registry-list', runObjectArgs: (args) => runRegistryListCommand(args as RegistryCommandInput) },
  { name: 'route', runObjectArgs: (args) => runRouteCommand(args as RouteInput) },
  { name: 'route-inbox', runObjectArgs: (args) => runRouteInboxCommand(args as RegistryCommandInput) },
  { name: 'route-accept', runObjectArgs: (args) => runRouteAcceptCommand(args as RouteAcceptInput) },
  { name: 'bridge-index', runObjectArgs: (args) => runBridgeIndexCommand(args as RegistryCommandInput) },
  { name: 'bridge-list', runObjectArgs: (args) => runBridgeListCommand(args as RegistryCommandInput) },
  { name: 'bridge-targets', runObjectArgs: (args) => runBridgeTargetsCommand(args as BridgeTargetsInput) },
  { name: 'bridge-accept', runObjectArgs: (args) => runBridgeAcceptCommand(args as BridgeDecisionInput) },
  { name: 'bridge-create-landing', runObjectArgs: (args) => runBridgeCreateLandingCommand(args as BridgeCreateLandingInput) },
  { name: 'bridge-reject', runObjectArgs: (args) => runBridgeRejectCommand(args as BridgeDecisionInput) },
  { name: 'query-registry', runObjectArgs: (args) => runQueryRegistryCommand(args as QueryRegistryInput) },
  { name: 'intake-scan', runObjectArgs: (args) => runIntakeScanCommand(args as RegistryCommandInput) },
  { name: 'intake-status', runObjectArgs: (args) => runIntakeStatusCommand(args as RegistryCommandInput) },
  { name: 'intake-next', runObjectArgs: (args) => runIntakeNextCommand(args as RegistryCommandInput) },
  { name: 'intake-complete', runObjectArgs: (args) => runIntakeCompleteCommand(args as IntakeCompleteInput) },
  { name: 'intake-reject', runObjectArgs: (args) => runIntakeRejectCommand(args as IntakeRejectInput) },
  { name: 'intake-park', runObjectArgs: (args) => runIntakeParkCommand(args as IntakeParkInput) },
  { name: 'profile-suggest', runObjectArgs: (args) => runProfileSuggestCommand(args as ProfileSuggestInput) },
  { name: 'profile-accept', runObjectArgs: (args) => runProfileAcceptCommand(args as ProfileDecisionInput) },
  { name: 'profile-reject', runObjectArgs: (args) => runProfileRejectCommand(args as ProfileDecisionInput) },
  { name: 'profile-review', runObjectArgs: (args) => runProfileReviewCommand(args as RegistryCommandInput) },
]

const CLI_COMMAND_NAMES = CLI_COMMAND_SPECS.map((spec) => spec.name)
const CLI_USAGE = `usage: llm-wiki <${CLI_COMMAND_NAMES.join('|')}> <knowledgeRoot|registryRoot> [...args]`

export function buildCli(): Cli {
  return {
    commands: CLI_COMMAND_SPECS.map((spec) => ({
      name: () => spec.name,
      run: spec.runObjectArgs,
    })),
  }
}

function runIngestOrInboxCommand(input: Partial<IngestCommandInput> & IngestInboxCommandInput): Promise<IngestJobResult | IngestInboxCommandResult> {
  return typeof input.input === 'string' && input.input.trim().length > 0
    ? runIngestCommand({
        knowledgeRoot: input.knowledgeRoot,
        input: input.input,
        qualityPath: input.qualityPath,
        curationPath: input.curationPath,
        extractEntities: Boolean(input.extractEntities),
        extractKeyInfo: Boolean(input.extractKeyInfo),
        forceRecompile: Boolean(input.forceRecompile),
      })
    : runIngestInboxCommand({ knowledgeRoot: input.knowledgeRoot })
}

export const runCliFromArgv = createRunCliFromArgv({
  runInitCommand,
  runIngestCommand: (input) => runIngestCommand(input as IngestCommandInput),
  runIngestInboxCommand,
  runImportOkfBundleCommand: (input) => runImportOkfBundleCommand(input as ImportOkfBundleInput),
  runQueryCommand: (input) => runQueryCommand(input as QueryCommandInput),
  runQueryReadinessCommand,
  runEmbedIndexCommand,
  runExportBundleCommand: (input) => runExportBundleCommand(input as ExportOkfBundleInput),
  runLintCommand,
  runBuildIndexCommand,
  runWikiOverviewCommand,
  runMaintainCommand,
  runTaxonomyListCommand,
  runTaxonomyAcceptCommand: (input) => runTaxonomyAcceptCommand(input as TaxonomyActionCommandInput),
  runTaxonomyRejectCommand: (input) => runTaxonomyRejectCommand(input as TaxonomyActionCommandInput),
  runStatusCommand,
  runSaveSynthesisCommand: (input) => runSaveSynthesisCommand(input as SaveSynthesisCommandInput),
  runRegistryInitCommand,
  runRegistryAddCommand: (input) => runRegistryAddCommand(input as RegistryAddInput),
  runRegistryListCommand,
  runRouteCommand: (input) => runRouteCommand(input as RouteInput),
  runRouteInboxCommand,
  runRouteAcceptCommand: (input) => runRouteAcceptCommand(input as RouteAcceptInput),
  runBridgeIndexCommand,
  runBridgeListCommand,
  runBridgeTargetsCommand: (input) => runBridgeTargetsCommand(input as BridgeTargetsInput),
  runBridgeAcceptCommand: (input) => runBridgeAcceptCommand(input as BridgeDecisionInput),
  runBridgeCreateLandingCommand: (input) => runBridgeCreateLandingCommand(input as BridgeCreateLandingInput),
  runBridgeRejectCommand: (input) => runBridgeRejectCommand(input as BridgeDecisionInput),
  runQueryRegistryCommand: (input) => runQueryRegistryCommand(input as QueryRegistryInput),
  runIntakeScanCommand,
  runIntakeStatusCommand,
  runIntakeNextCommand,
  runIntakeCompleteCommand: (input) => runIntakeCompleteCommand(input as IntakeCompleteInput),
  runIntakeRejectCommand: (input) => runIntakeRejectCommand(input as IntakeRejectInput),
  runIntakeParkCommand: (input) => runIntakeParkCommand(input as IntakeParkInput),
  runProfileSuggestCommand: (input) => runProfileSuggestCommand(input as ProfileSuggestInput),
  runProfileAcceptCommand: (input) => runProfileAcceptCommand(input as ProfileDecisionInput),
  runProfileRejectCommand: (input) => runProfileRejectCommand(input as ProfileDecisionInput),
  runProfileReviewCommand,
}, CLI_USAGE)

export async function runCliMain(argv: string[] = process.argv.slice(2)): Promise<void> {
  const result = await runCliFromArgv(argv)
  process.stdout.write(`${JSON.stringify(formatCliResult(argv, result), null, 2)}\n`)
}


function isDirectCliExecution(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

if (isDirectCliExecution()) {
  runCliMain().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
