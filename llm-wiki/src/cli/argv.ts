import { buildQueryIntent } from '../query/intent.js'
import type { QueryCommandResult } from '../query/query.js'
import type { QueryRegistryResult } from '../retrieval/registry.js'
import { runDedupFromArgv } from './dedup-command.js'
import { firstFlag, parseCliFlags, parseQueryArgs } from './flags.js'

export type CliArgvHandlers = {
  runInitCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runIngestCommand(input: Record<string, unknown>): Promise<unknown>
  runIngestInboxCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runImportOkfBundleCommand(input: Record<string, unknown>): Promise<unknown>
  runQueryCommand(input: Record<string, unknown>): Promise<unknown>
  runQueryReadinessCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runEmbedIndexCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runExportBundleCommand(input: Record<string, unknown>): Promise<unknown>
  runLintCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runBuildIndexCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runWikiOverviewCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runMaintainCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runTaxonomyListCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runTaxonomyAcceptCommand(input: Record<string, unknown>): Promise<unknown>
  runTaxonomyRejectCommand(input: Record<string, unknown>): Promise<unknown>
  runStatusCommand(input: { knowledgeRoot: string }): Promise<unknown>
  runSaveSynthesisCommand(input: Record<string, unknown>): Promise<unknown>
  runRegistryInitCommand(input: { registryRoot: string }): Promise<unknown>
  runRegistryAddCommand(input: Record<string, unknown>): Promise<unknown>
  runRegistryListCommand(input: { registryRoot: string }): Promise<unknown>
  runRouteCommand(input: Record<string, unknown>): Promise<unknown>
  runRouteInboxCommand(input: { registryRoot: string }): Promise<unknown>
  runRouteAcceptCommand(input: Record<string, unknown>): Promise<unknown>
  runBridgeIndexCommand(input: { registryRoot: string }): Promise<unknown>
  runBridgeListCommand(input: { registryRoot: string }): Promise<unknown>
  runBridgeTargetsCommand(input: Record<string, unknown>): Promise<unknown>
  runBridgeAcceptCommand(input: Record<string, unknown>): Promise<unknown>
  runBridgeCreateLandingCommand(input: Record<string, unknown>): Promise<unknown>
  runBridgeRejectCommand(input: Record<string, unknown>): Promise<unknown>
  runQueryRegistryCommand(input: Record<string, unknown>): Promise<unknown>
  runIntakeScanCommand(input: { registryRoot: string }): Promise<unknown>
  runIntakeStatusCommand(input: { registryRoot: string }): Promise<unknown>
  runIntakeNextCommand(input: { registryRoot: string }): Promise<unknown>
  runIntakeCompleteCommand(input: Record<string, unknown>): Promise<unknown>
  runIntakeRejectCommand(input: Record<string, unknown>): Promise<unknown>
  runIntakeParkCommand(input: Record<string, unknown>): Promise<unknown>
  runProfileSuggestCommand(input: Record<string, unknown>): Promise<unknown>
  runProfileAcceptCommand(input: Record<string, unknown>): Promise<unknown>
  runProfileRejectCommand(input: Record<string, unknown>): Promise<unknown>
  runProfileReviewCommand(input: { registryRoot: string }): Promise<unknown>
}

export function createRunCliFromArgv(handlers: CliArgvHandlers, usage: string): (argv: string[]) => Promise<unknown> {
  return async function runCliFromArgv(argv: string[]): Promise<unknown> {
    const [command, knowledgeRoot, ...rest] = argv

    if (!command || !knowledgeRoot) {
      throw new Error(usage)
    }

    switch (command) {
      case 'init':
        return handlers.runInitCommand({ knowledgeRoot })
      case 'ingest': {
        if (rest[0] === '--okf') {
          const bundleDir = rest[1]
          if (!bundleDir || bundleDir.startsWith('--')) {
            throw new Error('usage: llm-wiki ingest <knowledgeRoot> --okf <bundleDir> [--auto-index]')
          }
          const remaining = rest.slice(2)
          const autoIndex = remaining.includes('--auto-index')
          const unknownFlags = remaining.filter((arg) => arg !== '--auto-index')
          if (unknownFlags.length > 0) {
            throw new Error(`Unknown flag for ingest --okf: ${unknownFlags[0]}`)
          }
          return handlers.runImportOkfBundleCommand({ knowledgeRoot, bundleDir, autoIndex })
        }
        const [input, ...flagArgs] = rest
        if (!input) {
          return handlers.runIngestInboxCommand({ knowledgeRoot })
        }
        const extractEntities = flagArgs.includes('--extract-entities')
        const extractKeyInfo = flagArgs.includes('--extract-key-info')
        const forceRecompile = flagArgs.includes('--recompile')
        const valueFlagArgs = flagArgs.filter((arg) => arg !== '--extract-entities' && arg !== '--extract-key-info' && arg !== '--recompile')
        const flags = parseCliFlags(valueFlagArgs)
        const qualityPath = firstFlag(flags, 'quality')
        const curationPath = firstFlag(flags, 'curation')
        const unknownFlags = flagArgs.filter((arg, index) => {
          if (arg === '--extract-entities' || arg === '--extract-key-info' || arg === '--recompile') return false
          if (arg === '--quality') return false
          if (index > 0 && flagArgs[index - 1] === '--quality') return false
          if (arg === '--curation') return false
          if (index > 0 && flagArgs[index - 1] === '--curation') return false
          return true
        })
        if (unknownFlags.length > 0) {
          throw new Error(`Unknown flag for ingest: ${unknownFlags[0]}`)
        }
        return handlers.runIngestCommand({ knowledgeRoot, input, qualityPath, curationPath, extractEntities, extractKeyInfo, forceRecompile })
      }
      case 'ingest-inbox':
        return handlers.runIngestInboxCommand({ knowledgeRoot })
      case 'dedup':
        return runDedupFromArgv(knowledgeRoot, rest)
      case 'query': {
        const queryOptions = parseQueryArgs(rest)
        if (!queryOptions.question) {
          throw new Error('usage: llm-wiki query <knowledgeRoot> <question> [--include-review] [--no-hyde] [--reading-mode <passage|document>] [--full]')
        }
        return handlers.runQueryCommand({
          knowledgeRoot,
          question: queryOptions.question,
          includeReview: queryOptions.includeReview,
          disableHyde: queryOptions.disableHyde,
          queryIntent: buildQueryIntent(queryOptions.question, [], { readingMode: queryOptions.readingMode }),
        })
      }
      case 'query-readiness':
        if (rest.length > 0) {
          throw new Error(`Unknown flag for query-readiness: ${rest[0]}`)
        }
        return handlers.runQueryReadinessCommand({ knowledgeRoot })
      case 'embed-index':
        return handlers.runEmbedIndexCommand({ knowledgeRoot })
      case 'export-bundle': {
        const flags = parseCliFlags(rest)
        const outputDir = firstFlag(flags, 'okf')
        if (!outputDir) {
          throw new Error('usage: llm-wiki export-bundle <knowledgeRoot> --okf <outputDir> [--archive <archivePath>]')
        }
        return handlers.runExportBundleCommand({ knowledgeRoot, outputDir, archivePath: firstFlag(flags, 'archive') })
      }
      case 'lint':
        return handlers.runLintCommand({ knowledgeRoot })
      case 'index':
        return handlers.runBuildIndexCommand({ knowledgeRoot })
      case 'wiki-overview':
        if (rest.length > 0) {
          throw new Error(`Unknown flag for wiki-overview: ${rest[0]}`)
        }
        return handlers.runWikiOverviewCommand({ knowledgeRoot })
      case 'maintain':
        if (rest.length > 0) {
          throw new Error(`Unknown flag for maintain: ${rest[0]}`)
        }
        return handlers.runMaintainCommand({ knowledgeRoot })
      case 'taxonomy-list':
        return handlers.runTaxonomyListCommand({ knowledgeRoot })
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
        return handlers.runTaxonomyAcceptCommand({ knowledgeRoot, slug, reviewer })
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
        return handlers.runTaxonomyRejectCommand({
          knowledgeRoot,
          slug,
          reviewer,
          reason: firstFlag(flags, 'reason'),
        })
      }
      case 'status':
        return handlers.runStatusCommand({ knowledgeRoot })
      case 'save-synthesis': {
        const [suggestionId, confirmFlag] = rest
        if (!suggestionId) {
          throw new Error('usage: llm-wiki save-synthesis <knowledgeRoot> <suggestionId> [--confirm]')
        }
        if (confirmFlag && confirmFlag !== '--confirm') {
          throw new Error(`Unknown flag for save-synthesis: ${confirmFlag}`)
        }
        return handlers.runSaveSynthesisCommand({
          knowledgeRoot,
          suggestionId,
          confirm: confirmFlag === '--confirm',
        })
      }
      case 'registry-init':
        return handlers.runRegistryInitCommand({ registryRoot: knowledgeRoot })
      case 'registry-list':
        return handlers.runRegistryListCommand({ registryRoot: knowledgeRoot })
      case 'registry-add': {
        const hasExplicitWikiRoot = Boolean(rest[0]) && !rest[0]!.startsWith('--')
        const wikiRoot = hasExplicitWikiRoot ? rest[0] : undefined
        const flagArgs = hasExplicitWikiRoot ? rest.slice(1) : rest
        const flags = parseCliFlags(flagArgs)
        const id = firstFlag(flags, 'id')
        if (!id) {
          throw new Error('registry-add requires --id <wikiId>')
        }
        return handlers.runRegistryAddCommand({
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
        return handlers.runRouteCommand({ registryRoot: knowledgeRoot, source })
      }
      case 'route-inbox':
        return handlers.runRouteInboxCommand({ registryRoot: knowledgeRoot })
      case 'bridge-index':
        return handlers.runBridgeIndexCommand({ registryRoot: knowledgeRoot })
      case 'bridge-list':
        return handlers.runBridgeListCommand({ registryRoot: knowledgeRoot })
      case 'bridge-targets': {
        const [proposalId] = rest
        if (!proposalId) {
          throw new Error('usage: llm-wiki bridge-targets <registryRoot> <proposalId>')
        }
        return handlers.runBridgeTargetsCommand({ registryRoot: knowledgeRoot, proposalId })
      }
      case 'bridge-accept': {
        const [proposalId, ...flagArgs] = rest
        if (!proposalId) {
          throw new Error('usage: llm-wiki bridge-accept <registryRoot> <proposalId> --target <wikiId>/<section>/<slug> --reviewer <name> [--reason <reason>]')
        }
        const flags = parseCliFlags(flagArgs)
        const reviewer = firstFlag(flags, 'reviewer')
        const target = firstFlag(flags, 'target')
        if (!reviewer) {
          throw new Error('bridge-accept requires --reviewer <name>')
        }
        if (!target) {
          throw new Error('bridge-accept requires --target <wikiId>/<section>/<slug>')
        }
        return handlers.runBridgeAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, target, reason: firstFlag(flags, 'reason') })
      }
      case 'bridge-create-landing': {
        const [proposalId, ...flagArgs] = rest
        if (!proposalId) {
          throw new Error('usage: llm-wiki bridge-create-landing <registryRoot> <proposalId> --slug <slug> --reviewer <name> [--section bridges] [--reason <reason>]')
        }
        const flags = parseCliFlags(flagArgs)
        const reviewer = firstFlag(flags, 'reviewer')
        const slug = firstFlag(flags, 'slug')
        if (!reviewer) {
          throw new Error('bridge-create-landing requires --reviewer <name>')
        }
        if (!slug) {
          throw new Error('bridge-create-landing requires --slug <slug>')
        }
        return handlers.runBridgeCreateLandingCommand({
          registryRoot: knowledgeRoot,
          proposalId,
          reviewer,
          slug,
          section: firstFlag(flags, 'section'),
          reason: firstFlag(flags, 'reason'),
        })
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
        return handlers.runBridgeRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason })
      }
      case 'route-accept': {
        const [proposalId, ...flagArgs] = rest
        if (!proposalId) {
          throw new Error('usage: llm-wiki route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>] --quality <quality.json> --curation <curation.json>')
        }
        const flags = parseCliFlags(flagArgs)
        return handlers.runRouteAcceptCommand({
          registryRoot: knowledgeRoot,
          proposalId,
          wikiId: firstFlag(flags, 'wiki'),
          reviewer: firstFlag(flags, 'reviewer'),
          qualityPath: firstFlag(flags, 'quality'),
          curationPath: firstFlag(flags, 'curation'),
        })
      }
      case 'query-registry': {
        const queryOptions = parseQueryArgs(rest)
        if (!queryOptions.question) {
          throw new Error('usage: llm-wiki query-registry <registryRoot> <question> [--reading-mode <passage|document>] [--full]')
        }
        return handlers.runQueryRegistryCommand({
          registryRoot: knowledgeRoot,
          question: queryOptions.question,
          readingMode: queryOptions.readingMode,
        })
      }
      case 'intake-scan':
        return handlers.runIntakeScanCommand({ registryRoot: knowledgeRoot })
      case 'intake-status':
        return handlers.runIntakeStatusCommand({ registryRoot: knowledgeRoot })
      case 'intake-next':
        return handlers.runIntakeNextCommand({ registryRoot: knowledgeRoot })
      case 'intake-complete': {
        const [itemId, ...flagArgs] = rest
        if (!itemId) {
          throw new Error('usage: llm-wiki intake-complete <registryRoot> <itemId> [--reviewer <name>]')
        }
        const flags = parseCliFlags(flagArgs)
        return handlers.runIntakeCompleteCommand({ registryRoot: knowledgeRoot, itemId, reviewer: firstFlag(flags, 'reviewer') })
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
        return handlers.runIntakeRejectCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason })
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
        return handlers.runIntakeParkCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason })
      }
      case 'profile-suggest': {
        const flags = parseCliFlags(rest)
        return handlers.runProfileSuggestCommand({
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
        return handlers.runProfileAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') })
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
        return handlers.runProfileRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason })
      }
      case 'profile-review':
        return handlers.runProfileReviewCommand({ registryRoot: knowledgeRoot })
      default:
        throw new Error(`unknown command: ${command}`)
    }
  }
}

export function formatCliResult(argv: string[], result: unknown): unknown {
  const command = argv[0]
  const full = argv.includes('--full')
  if (full) {
    return result
  }
  if (command === 'query' && isQueryCommandResult(result)) {
    return {
      question: result.question,
      answerability: result.sourceReadingPack.answerability,
      readiness: result.readiness,
      sourceReadingPack: result.sourceReadingPack,
    }
  }
  if (command === 'query-registry' && isQueryRegistryResult(result)) {
    return {
      question: result.question,
      answerability: result.sourceReadingPack.answerability,
      readiness: result.diagnostics.readiness,
      sourceReadingPack: result.sourceReadingPack,
    }
  }
  return result
}

function isQueryCommandResult(result: unknown): result is QueryCommandResult {
  return Boolean(result && typeof result === 'object' && 'sourceReadingPack' in result && 'grounding' in result)
}

function isQueryRegistryResult(result: unknown): result is QueryRegistryResult {
  return Boolean(result && typeof result === 'object' && 'sourceReadingPack' in result && 'selectedWikis' in result)
}
