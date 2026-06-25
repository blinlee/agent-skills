import { buildQueryIntent } from '../query/intent.js'
import type { QueryCommandResult } from '../query/query.js'
import type { QueryRegistryResult } from '../retrieval/registry.js'
import { runDedupFromArgv } from './dedup-command.js'
import { firstFlag, parseCliFlags, parseQueryArgs } from './flags.js'
import { isRegistryArgvCommand, runRegistryArgvCommand } from './registry-argv.js'

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

    if (isRegistryArgvCommand(command)) {
      return runRegistryArgvCommand({
        command,
        registryRoot: knowledgeRoot,
        rest,
        handlers,
      })
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
