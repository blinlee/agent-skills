#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import {
  acceptTaxonomyProposal,
  listTaxonomyProposals,
  rejectTaxonomyProposal,
  type AcceptTaxonomyProposalInput,
  type ListTaxonomyProposalsResult,
  type RejectTaxonomyProposalInput,
} from './governance/taxonomy.js'
import { runIngestJob, type IngestJobResult } from './jobs/job-runner.js'
import { runBuildIndex, type BuildIndexInput, type BuildIndexResult } from './index/wiki-index.js'
import { runLint, type LintCommandInput, type LintCommandResult } from './lint/lint.js'
import { defaultKnowledgeLayout, ensureKnowledgeRootLayout, requiredKnowledgeFiles } from './paths.js'
import { runQuery, type QueryCommandInput, type QueryCommandResult } from './query/query.js'
import { runSaveSynthesis, type SaveSynthesisCommandInput, type SaveSynthesisCommandResult } from './query/save-synthesis.js'
import {
  runBridgeIndex,
  runBridgeAccept,
  runBridgeList,
  runBridgeReject,
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
  type BridgeDecisionInput,
  type BridgeDecisionResult,
  type BridgeListResult,
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
import type { JobStatus } from './types.js'

type CliCommand = {
  name: () => string
  run?: (args: Record<string, unknown>) => Promise<unknown>
}

type Cli = {
  commands: CliCommand[]
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
}

export type IngestInboxCommandInput = {
  knowledgeRoot: string
}

export type IngestInboxCommandResult = {
  knowledgeRoot: string
  inboxPath: string
  results: IngestJobResult[]
}


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

export type StatusCommandInput = {
  knowledgeRoot: string
}

export type StatusCommandResult = {
  knowledgeRoot: string
  knowledgeRootExists: boolean
  readiness: 'ready' | 'incomplete'
  configSummary: ReturnType<typeof loadConfig>
  jobCounts: Partial<Record<JobStatus, number>>
  jobCountsByState: Partial<Record<JobStatus, number>>
  requiredDirectories: {
    present: string[]
    missing: string[]
  }
  requiredFiles: {
    present: string[]
    missing: string[]
  }
}

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

export async function runQueryCommand(input: QueryCommandInput): Promise<QueryCommandResult> {
  return runQuery(input)
}

export async function runLintCommand(input: LintCommandInput): Promise<LintCommandResult> {
  return runLint(input)
}

export async function runBuildIndexCommand(input: BuildIndexInput): Promise<BuildIndexResult> {
  return runBuildIndex(input)
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

export async function runBridgeAcceptCommand(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  return runBridgeAccept(input)
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

export async function runStatusCommand(input: StatusCommandInput): Promise<StatusCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const configSummary = loadConfig({
    knowledgeRoot,
    jobStorePath: path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
  })

  const requiredDirectories = await summarizeRequiredPaths(knowledgeRoot, defaultKnowledgeLayout)
  const requiredFiles = await summarizeRequiredPaths(
    knowledgeRoot,
    requiredKnowledgeFiles.map((file) => file.relativePath),
  )
  const jobCountsByState = await readJobCounts(configSummary.jobStorePath)
  const jobCounts = { ...jobCountsByState }
  const readiness = requiredDirectories.missing.length === 0 && requiredFiles.missing.length === 0
    ? 'ready'
    : 'incomplete'

  return {
    knowledgeRoot,
    knowledgeRootExists: await exists(knowledgeRoot),
    readiness,
    configSummary,
    jobCounts,
    jobCountsByState,
    requiredDirectories,
    requiredFiles,
  }
}

export function buildCli(): Cli {
  return {
    commands: [
      { name: () => 'init', run: (args) => runInitCommand(args as InitCommandInput) },
      { name: () => 'ingest', run: (args) => runIngestOrInboxCommand(args as Partial<IngestCommandInput> & IngestInboxCommandInput) },
      { name: () => 'ingest-inbox', run: (args) => runIngestInboxCommand(args as IngestInboxCommandInput) },
      { name: () => 'query', run: (args) => runQueryCommand(args as QueryCommandInput) },
      { name: () => 'lint', run: (args) => runLintCommand(args as LintCommandInput) },
      { name: () => 'index', run: (args) => runBuildIndexCommand(args as BuildIndexInput) },
      { name: () => 'taxonomy-list', run: (args) => runTaxonomyListCommand(args as { knowledgeRoot: string }) },
      { name: () => 'taxonomy-accept', run: (args) => runTaxonomyAcceptCommand(args as TaxonomyActionCommandInput) },
      { name: () => 'taxonomy-reject', run: (args) => runTaxonomyRejectCommand(args as TaxonomyActionCommandInput) },
      { name: () => 'status', run: (args) => runStatusCommand(args as StatusCommandInput) },
      { name: () => 'save-synthesis', run: (args) => runSaveSynthesisCommand(args as SaveSynthesisCommandInput) },
      { name: () => 'registry-init', run: (args) => runRegistryInitCommand(args as RegistryCommandInput) },
      { name: () => 'registry-add', run: (args) => runRegistryAddCommand(args as RegistryAddInput) },
      { name: () => 'registry-list', run: (args) => runRegistryListCommand(args as RegistryCommandInput) },
      { name: () => 'route', run: (args) => runRouteCommand(args as RouteInput) },
      { name: () => 'route-inbox', run: (args) => runRouteInboxCommand(args as RegistryCommandInput) },
      { name: () => 'bridge-index', run: (args) => runBridgeIndexCommand(args as RegistryCommandInput) },
      { name: () => 'bridge-list', run: (args) => runBridgeListCommand(args as RegistryCommandInput) },
      { name: () => 'bridge-accept', run: (args) => runBridgeAcceptCommand(args as BridgeDecisionInput) },
      { name: () => 'bridge-reject', run: (args) => runBridgeRejectCommand(args as BridgeDecisionInput) },
      { name: () => 'route-accept', run: (args) => runRouteAcceptCommand(args as RouteAcceptInput) },
      { name: () => 'query-registry', run: (args) => runQueryRegistryCommand(args as QueryRegistryInput) },
      { name: () => 'intake-scan', run: (args) => runIntakeScanCommand(args as RegistryCommandInput) },
      { name: () => 'intake-status', run: (args) => runIntakeStatusCommand(args as RegistryCommandInput) },
      { name: () => 'intake-next', run: (args) => runIntakeNextCommand(args as RegistryCommandInput) },
      { name: () => 'intake-complete', run: (args) => runIntakeCompleteCommand(args as IntakeCompleteInput) },
      { name: () => 'intake-reject', run: (args) => runIntakeRejectCommand(args as IntakeRejectInput) },
      { name: () => 'intake-park', run: (args) => runIntakeParkCommand(args as IntakeParkInput) },
      { name: () => 'profile-suggest', run: (args) => runProfileSuggestCommand(args as ProfileSuggestInput) },
      { name: () => 'profile-accept', run: (args) => runProfileAcceptCommand(args as ProfileDecisionInput) },
      { name: () => 'profile-reject', run: (args) => runProfileRejectCommand(args as ProfileDecisionInput) },
      { name: () => 'profile-review', run: (args) => runProfileReviewCommand(args as RegistryCommandInput) },
    ],
  }
}

function runIngestOrInboxCommand(input: Partial<IngestCommandInput> & IngestInboxCommandInput): Promise<IngestJobResult | IngestInboxCommandResult> {
  return typeof input.input === 'string' && input.input.trim().length > 0
    ? runIngestCommand({ knowledgeRoot: input.knowledgeRoot, input: input.input })
    : runIngestInboxCommand({ knowledgeRoot: input.knowledgeRoot })
}

export async function runCliFromArgv(argv: string[]): Promise<unknown> {
  const [command, knowledgeRoot, ...rest] = argv

  if (!command || !knowledgeRoot) {
    throw new Error('usage: llm-wiki <init|ingest|ingest-inbox|query|lint|index|taxonomy-list|taxonomy-accept|taxonomy-reject|status|save-synthesis|registry-init|registry-add|registry-list|route|route-inbox|route-accept|bridge-index|bridge-list|bridge-accept|bridge-reject|query-registry|intake-scan|intake-status|intake-next|intake-complete|intake-reject|intake-park|profile-suggest|profile-accept|profile-reject|profile-review> <knowledgeRoot|registryRoot> [...args]')
  }

  switch (command) {
    case 'init':
      return runInitCommand({ knowledgeRoot })
    case 'ingest': {
      const [input] = rest
      if (!input) {
        return runIngestInboxCommand({ knowledgeRoot })
      }
      return runIngestCommand({ knowledgeRoot, input })
    }
    case 'ingest-inbox':
      return runIngestInboxCommand({ knowledgeRoot })
    case 'query': {
      const question = rest.join(' ').trim()
      if (!question) {
        throw new Error('usage: llm-wiki query <knowledgeRoot> <question>')
      }
      return runQueryCommand({ knowledgeRoot, question })
    }
    case 'lint':
      return runLintCommand({ knowledgeRoot })
    case 'index':
      return runBuildIndexCommand({ knowledgeRoot })
    case 'taxonomy-list':
      return runTaxonomyListCommand({ knowledgeRoot })
    case 'taxonomy-accept': {
      const [slug, ...flagArgs] = rest
      if (!slug) {
        throw new Error('usage: llm-wiki taxonomy-accept <knowledgeRoot> <proposalSlug> --reviewer <name>')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      if (!reviewer) {
        throw new Error('taxonomy-accept requires --reviewer <name> after human confirmation')
      }
      return runTaxonomyAcceptCommand({ knowledgeRoot, slug, reviewer })
    }
    case 'taxonomy-reject': {
      const [slug, ...flagArgs] = rest
      if (!slug) {
        throw new Error('usage: llm-wiki taxonomy-reject <knowledgeRoot> <proposalSlug> --reviewer <name> [--reason <reason>]')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      if (!reviewer) {
        throw new Error('taxonomy-reject requires --reviewer <name> after human confirmation')
      }
      return runTaxonomyRejectCommand({
        knowledgeRoot,
        slug,
        reviewer,
        reason: firstFlag(flags, 'reason'),
      })
    }
    case 'status':
      return runStatusCommand({ knowledgeRoot })
    case 'save-synthesis': {
      const [suggestionId, confirmFlag] = rest
      if (!suggestionId) {
        throw new Error('usage: llm-wiki save-synthesis <knowledgeRoot> <suggestionId> [--confirm]')
      }
      if (confirmFlag && confirmFlag !== '--confirm') {
        throw new Error(`Unknown flag for save-synthesis: ${confirmFlag}`)
      }
      return runSaveSynthesisCommand({
        knowledgeRoot,
        suggestionId,
        confirm: confirmFlag === '--confirm',
      })
    }
    case 'registry-init':
      return runRegistryInitCommand({ registryRoot: knowledgeRoot })
    case 'registry-list':
      return runRegistryListCommand({ registryRoot: knowledgeRoot })
    case 'registry-add': {
      const hasExplicitWikiRoot = Boolean(rest[0]) && !rest[0]!.startsWith('--')
      const wikiRoot = hasExplicitWikiRoot ? rest[0] : undefined
      const flagArgs = hasExplicitWikiRoot ? rest.slice(1) : rest
      const flags = parseCliFlags(flagArgs)
      const id = firstFlag(flags, 'id')
      if (!id) {
        throw new Error('registry-add requires --id <wikiId>')
      }
      return runRegistryAddCommand({
        registryRoot: knowledgeRoot,
        knowledgeRoot: wikiRoot,
        id,
        title: firstFlag(flags, 'title'),
        scope: flags.scope ?? [],
        scopeCore: flags['scope-core'] ?? [],
        scopeAdjacent: flags['scope-adjacent'] ?? [],
        outOfScope: flags['out-of-scope'] ?? [],
        aliases: [...(flags.alias ?? []), ...(flags.aliases ?? [])],
        profileNotes: flags['profile-note'] ?? [],
      })
    }
    case 'route': {
      const [source] = rest
      if (!source) {
        throw new Error('usage: llm-wiki route <registryRoot> <sourcePathOrUrl>')
      }
      return runRouteCommand({ registryRoot: knowledgeRoot, source })
    }
    case 'route-inbox':
      return runRouteInboxCommand({ registryRoot: knowledgeRoot })
    case 'bridge-index':
      return runBridgeIndexCommand({ registryRoot: knowledgeRoot })
    case 'bridge-list':
      return runBridgeListCommand({ registryRoot: knowledgeRoot })
    case 'bridge-accept': {
      const [proposalId, ...flagArgs] = rest
      if (!proposalId) {
        throw new Error('usage: llm-wiki bridge-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      if (!reviewer) {
        throw new Error('bridge-accept requires --reviewer <name>')
      }
      return runBridgeAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') })
    }
    case 'bridge-reject': {
      const [proposalId, ...flagArgs] = rest
      if (!proposalId) {
        throw new Error('usage: llm-wiki bridge-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      const reason = firstFlag(flags, 'reason')
      if (!reviewer) {
        throw new Error('bridge-reject requires --reviewer <name>')
      }
      if (!reason) {
        throw new Error('bridge-reject requires --reason <reason>')
      }
      return runBridgeRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason })
    }
    case 'route-accept': {
      const [proposalId, ...flagArgs] = rest
      if (!proposalId) {
        throw new Error('usage: llm-wiki route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>]')
      }
      const flags = parseCliFlags(flagArgs)
      return runRouteAcceptCommand({
        registryRoot: knowledgeRoot,
        proposalId,
        wikiId: firstFlag(flags, 'wiki'),
        reviewer: firstFlag(flags, 'reviewer'),
      })
    }
    case 'query-registry': {
      const question = rest.join(' ').trim()
      if (!question) {
        throw new Error('usage: llm-wiki query-registry <registryRoot> <question>')
      }
      return runQueryRegistryCommand({ registryRoot: knowledgeRoot, question })
    }
    case 'intake-scan':
      return runIntakeScanCommand({ registryRoot: knowledgeRoot })
    case 'intake-status':
      return runIntakeStatusCommand({ registryRoot: knowledgeRoot })
    case 'intake-next':
      return runIntakeNextCommand({ registryRoot: knowledgeRoot })
    case 'intake-complete': {
      const [itemId, ...flagArgs] = rest
      if (!itemId) {
        throw new Error('usage: llm-wiki intake-complete <registryRoot> <itemId> [--reviewer <name>]')
      }
      const flags = parseCliFlags(flagArgs)
      return runIntakeCompleteCommand({ registryRoot: knowledgeRoot, itemId, reviewer: firstFlag(flags, 'reviewer') })
    }
    case 'intake-reject': {
      const [itemId, ...flagArgs] = rest
      if (!itemId) {
        throw new Error('usage: llm-wiki intake-reject <registryRoot> <itemId> --reviewer <name> --reason <reason>')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      const reason = firstFlag(flags, 'reason')
      if (!reviewer) {
        throw new Error('intake-reject requires --reviewer <name>')
      }
      if (!reason) {
        throw new Error('intake-reject requires --reason <reason>')
      }
      return runIntakeRejectCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason })
    }
    case 'intake-park': {
      const [itemId, ...flagArgs] = rest
      if (!itemId) {
        throw new Error('usage: llm-wiki intake-park <registryRoot> <itemId> --reviewer <name> --reason <reason>')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      const reason = firstFlag(flags, 'reason')
      if (!reviewer) {
        throw new Error('intake-park requires --reviewer <name>')
      }
      if (!reason) {
        throw new Error('intake-park requires --reason <reason>')
      }
      return runIntakeParkCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason })
    }
    case 'profile-suggest': {
      const flags = parseCliFlags(rest)
      return runProfileSuggestCommand({
        registryRoot: knowledgeRoot,
        intakeItemId: firstFlag(flags, 'from'),
        source: firstFlag(flags, 'source'),
        id: firstFlag(flags, 'id'),
        title: firstFlag(flags, 'title'),
      })
    }
    case 'profile-accept': {
      const [proposalId, ...flagArgs] = rest
      if (!proposalId) {
        throw new Error('usage: llm-wiki profile-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      if (!reviewer) {
        throw new Error('profile-accept requires --reviewer <name>')
      }
      return runProfileAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') })
    }
    case 'profile-reject': {
      const [proposalId, ...flagArgs] = rest
      if (!proposalId) {
        throw new Error('usage: llm-wiki profile-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>')
      }
      const flags = parseCliFlags(flagArgs)
      const reviewer = firstFlag(flags, 'reviewer')
      const reason = firstFlag(flags, 'reason')
      if (!reviewer) {
        throw new Error('profile-reject requires --reviewer <name>')
      }
      if (!reason) {
        throw new Error('profile-reject requires --reason <reason>')
      }
      return runProfileRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason })
    }
    case 'profile-review':
      return runProfileReviewCommand({ registryRoot: knowledgeRoot })
    default:
      throw new Error(`unknown command: ${command}`)
  }
}

export async function runCliMain(argv: string[] = process.argv.slice(2)): Promise<void> {
  const result = await runCliFromArgv(argv)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
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

async function summarizeRequiredPaths(knowledgeRoot: string, relativePaths: readonly string[]): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = []
  const missing: string[] = []

  for (const relativePath of relativePaths) {
    const targetPath = path.join(knowledgeRoot, relativePath)
    if (await exists(targetPath)) {
      present.push(relativePath)
    } else {
      missing.push(relativePath)
    }
  }

  return { present, missing }
}

async function readJobCounts(jobStorePath: string): Promise<Partial<Record<JobStatus, number>>> {
  try {
    const raw = await readFile(jobStorePath, 'utf8')
    const parsed = JSON.parse(raw) as { jobs?: Record<string, { status?: JobStatus }> }
    const counts: Partial<Record<JobStatus, number>> = {}

    for (const job of Object.values(parsed.jobs ?? {})) {
      if (!job.status) {
        continue
      }

      counts[job.status] = (counts[job.status] ?? 0) + 1
    }

    return counts
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
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
