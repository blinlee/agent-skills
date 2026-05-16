import path from 'node:path'
import {
  runInitCommand,
  runIngestCommand,
  runIngestInboxCommand,
  runLintCommand,
  runQueryCommand,
  runSaveSynthesisCommand,
  runStatusCommand,
  type InitCommandResult,
  type IngestInboxCommandResult,
  type StatusCommandResult,
} from '../cli'
import type { IngestJobResult } from '../jobs/job-runner'
import type { LintCommandResult } from '../lint/lint'
import type { QueryCommandResult } from '../query/query'
import type { SaveSynthesisCommandResult } from '../query/save-synthesis'

export type SkillCommand = 'init' | 'ingest' | 'query' | 'lint' | 'status' | 'save-synthesis'

export type HandleSkillIntentInput = {
  intent: string
  knowledgeRoot: string
  input?: string
  question?: string
  suggestionId?: string
  confirm?: boolean
}

type HandleSkillIntentResultBase<TCommand extends SkillCommand, TPayload> = {
  intent: string
  command: TCommand
  status: string
  summary: string
  payload: TPayload
}

export type HandleSkillIntentResult =
  | HandleSkillIntentResultBase<'init', InitCommandResult>
  | HandleSkillIntentResultBase<'ingest', IngestJobResult | IngestInboxCommandResult>
  | HandleSkillIntentResultBase<'query', QueryCommandResult>
  | HandleSkillIntentResultBase<'lint', LintCommandResult>
  | HandleSkillIntentResultBase<'status', StatusCommandResult>
  | HandleSkillIntentResultBase<'save-synthesis', SaveSynthesisCommandResult>

const COMMAND_PATTERNS: Array<{ command: SkillCommand; matches: RegExp[] }> = [
  { command: 'save-synthesis', matches: [/save\s+synthesis/, /promot(e|ion)/, /publish\s+synthesis/] },
  { command: 'status', matches: [/\bstatus\b/, /health/, /what\s+changed/, /show\s+state/] },
  { command: 'lint', matches: [/\blint\b/, /validate/, /check/, /audit/] },
  { command: 'query', matches: [/\bquery\b/, /\bask\b/, /question/, /search/] },
  { command: 'ingest', matches: [/\bingest\b/, /import/, /index/, /capture/, /add\s+source/] },
  { command: 'init', matches: [/\binit\b/, /bootstrap/, /setup/, /create\s+root/] },
]

export async function handleSkillIntent(input: HandleSkillIntentInput): Promise<HandleSkillIntentResult> {
  const command = normalizeSkillIntent(input.intent)
  const knowledgeRoot = path.resolve(input.knowledgeRoot)

  switch (command) {
    case 'init': {
      const payload = await runInitCommand({ knowledgeRoot })
      return {
        intent: input.intent,
        command,
        status: 'initialized',
        summary: `Initialized knowledge root at ${payload.knowledgeRoot} with ${payload.createdDirectories.length} core directories.`,
        payload,
      }
    }
    case 'ingest': {
      const payload = input.input && input.input.trim().length > 0
        ? await runIngestCommand({
            knowledgeRoot,
            input: normalizeSourceInput(requireLocalOrRemoteInput(input.input, 'ingest')),
          })
        : await runIngestInboxCommand({ knowledgeRoot })

      const summary = 'results' in payload
        ? `Ingested ${payload.results.length} inbox item(s): ${summarizeInboxResults(payload.results)}.`
        : `Ingest ${payload.status}: ${payload.writtenFiles.length} wiki files, ${payload.reviewFiles.length} review files, ${payload.taxonomyFiles.length} taxonomy files.`

      return {
        intent: input.intent,
        command,
        status: 'results' in payload ? 'inbox-ingested' : payload.status,
        summary,
        payload,
      }
    }
    case 'query': {
      const question = requireTextInput(input.question ?? input.input, 'query')
      const payload = await runQueryCommand({ knowledgeRoot, question })

      const suggestionSummary = payload.synthesisSuggestion
        ? `synthesis suggestion ${payload.synthesisSuggestion.id} is ${payload.synthesisSuggestion.status}.`
        : 'no synthesis suggestion was created because the evidence was insufficient or the query was collection-level.'

      return {
        intent: input.intent,
        command,
        status: 'answered',
        summary: `Answered query with ${payload.citations.length} citation(s); ${suggestionSummary}`,
        payload,
      }
    }
    case 'lint': {
      const payload = await runLintCommand({ knowledgeRoot })
      return {
        intent: input.intent,
        command,
        status: payload.status,
        summary: `Lint ${payload.status}: ${payload.errors.length} error(s), ${payload.warnings.length} warning(s), ${payload.checkedFiles.length} file(s) checked.`,
        payload,
      }
    }
    case 'status': {
      const payload = await runStatusCommand({ knowledgeRoot })
      return {
        intent: input.intent,
        command,
        status: payload.readiness,
        summary: `Knowledge root ${payload.knowledgeRootExists ? 'exists' : 'is missing'}; ${payload.requiredDirectories.present.length} required directories present, ${payload.requiredDirectories.missing.length} missing; ${payload.requiredFiles.present.length} required files present, ${payload.requiredFiles.missing.length} missing.`,
        payload,
      }
    }
    case 'save-synthesis': {
      const suggestionId = requireTextInput(input.suggestionId ?? input.input, 'save-synthesis')
      const payload = await runSaveSynthesisCommand({
        knowledgeRoot,
        suggestionId,
        confirm: input.confirm,
      })

      return {
        intent: input.intent,
        command,
        status: 'promoted',
        summary: `Promoted synthesis suggestion ${payload.suggestionId} to ${payload.pagePath}.`,
        payload,
      }
    }
  }
}

function summarizeInboxResults(results: IngestJobResult[]): string {
  const counts = results.reduce<Record<string, number>>((accumulator, result) => {
    accumulator[result.status] = (accumulator[result.status] ?? 0) + 1
    return accumulator
  }, {})

  return Object.entries(counts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ') || 'no sources found'
}

export function normalizeSkillIntent(intent: string): SkillCommand {
  const normalized = intent.trim().toLowerCase()

  for (const entry of COMMAND_PATTERNS) {
    if (entry.matches.some((pattern) => pattern.test(normalized))) {
      return entry.command
    }
  }

  throw new Error(`Unsupported skill intent: ${intent}`)
}

function normalizeSourceInput(input: string): string {
  if (/^[a-z]+:\/\//i.test(input.trim())) {
    return input.trim()
  }

  return path.resolve(input)
}

function requireLocalOrRemoteInput(value: string | undefined, command: SkillCommand): string {
  return requireTextInput(value, command)
}

function requireTextInput(value: string | undefined, command: SkillCommand): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Skill intent "${command}" requires a non-empty input value.`)
  }

  return value.trim()
}
