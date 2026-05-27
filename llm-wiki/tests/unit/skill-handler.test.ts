import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InitCommandResult, StatusCommandResult } from '../../src/cli'
import type { IngestJobResult } from '../../src/jobs/job-runner'
import type { LintCommandResult } from '../../src/lint/lint'
import type { QueryCommandResult } from '../../src/query/query'
import type { SaveSynthesisCommandResult } from '../../src/query/save-synthesis'

const cliMocks = vi.hoisted(() => ({
  runInitCommand: vi.fn(),
  runIngestCommand: vi.fn(),
  runIngestInboxCommand: vi.fn(),
  runQueryCommand: vi.fn(),
  runLintCommand: vi.fn(),
  runStatusCommand: vi.fn(),
  runSaveSynthesisCommand: vi.fn(),
}))

vi.mock('../../src/cli', () => ({
  runInitCommand: cliMocks.runInitCommand,
  runIngestCommand: cliMocks.runIngestCommand,
  runIngestInboxCommand: cliMocks.runIngestInboxCommand,
  runQueryCommand: cliMocks.runQueryCommand,
  runLintCommand: cliMocks.runLintCommand,
  runStatusCommand: cliMocks.runStatusCommand,
  runSaveSynthesisCommand: cliMocks.runSaveSynthesisCommand,
}))

import { handleSkillIntent } from '../../src/skill/handler'

beforeEach(() => {
  vi.clearAllMocks()

  const initResult = {
    knowledgeRoot: '/tmp/mock-root',
    createdDirectories: ['raw/inbox', 'review/queue', 'taxonomy', 'wiki/sources'],
  } satisfies InitCommandResult

  const ingestResult = {
    jobId: 'job-1',
    status: 'completed',
    sourceKind: 'md',
    dedupDecision: null,
    writtenFiles: ['wiki/sources/sample.md'],
    reviewFiles: [],
    taxonomyFiles: [],
    stagedPath: null,
    archivePath: '/tmp/mock-root/raw/archive/sample.md',
    rejectedPath: null,
    retainedPath: null,
  } satisfies IngestJobResult

  const queryResult = {
    question: 'What is OpenClaw?',
    answer: 'OpenClaw is an agent runtime.',
    citations: [
      {
        target: 'sources/openclaw',
        title: 'OpenClaw',
        filePath: 'wiki/sources/openclaw.md',
        excerpt: 'OpenClaw is an agent runtime.',
      },
    ],
    synthesisSuggestion: {
      id: 'syn-1',
      status: 'suggested',
      slug: 'openclaw-runtime',
      title: 'OpenClaw Runtime',
      filePath: 'review/queue/syn-1.json',
    },
  } satisfies QueryCommandResult

  const lintResult = {
    status: 'ok',
    errors: [],
    warnings: [],
    checkedFiles: ['wiki/sources/sample.md'],
  } satisfies LintCommandResult

  const statusResult = {
    knowledgeRoot: '/tmp/mock-root',
    knowledgeRootExists: true,
    readiness: 'ready',
    configSummary: {
      knowledgeRoot: '/tmp/mock-root',
      cacheDirectory: '/tmp/mock-root/.cache/llm-wiki',
      jobStorePath: '/tmp/mock-root/system/jobs/jobs.json',
      repoSamplingLimits: { maxFiles: 20, maxBytes: 1024 },
      urlFetchTimeoutMs: 5000,
    },
    jobCounts: { completed: 1 },
    jobCountsByState: { completed: 1 },
    requiredDirectories: {
      present: ['raw/inbox', 'review/queue', 'taxonomy', 'wiki/sources'],
      missing: [],
    },
    requiredFiles: {
      present: ['wiki/index.md', 'wiki/log.md', 'system/jobs/jobs.json'],
      missing: [],
    },
  } satisfies StatusCommandResult

  const saveSynthesisResult = {
    suggestionId: 'syn-1',
    promoted: true,
    pagePath: 'wiki/syntheses/syn-1.md',
    indexPath: 'wiki/index.md',
    logPath: 'wiki/log.md',
  } satisfies SaveSynthesisCommandResult

  cliMocks.runInitCommand.mockResolvedValue(initResult)
  cliMocks.runIngestCommand.mockResolvedValue(ingestResult)
  cliMocks.runIngestInboxCommand.mockResolvedValue({
    knowledgeRoot: '/tmp/mock-root',
    inboxPath: '/tmp/mock-root/raw/inbox',
    results: [ingestResult],
  })
  cliMocks.runQueryCommand.mockResolvedValue(queryResult)
  cliMocks.runLintCommand.mockResolvedValue(lintResult)
  cliMocks.runStatusCommand.mockResolvedValue(statusResult)
  cliMocks.runSaveSynthesisCommand.mockResolvedValue(saveSynthesisResult)
})

describe('skill facade', () => {
  it('maps ingest intent to CLI execution without owning durable state', async () => {
    const result = await handleSkillIntent({
      intent: 'ingest',
      knowledgeRoot: '/tmp/llm-wiki-e2e',
      input: 'tests/fixtures/inputs/sample.md',
    })

    expect(result.command).toBe('ingest')
    if (result.command !== 'ingest') {
      throw new Error(`Expected ingest command, received ${result.command}`)
    }

    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Ingest completed')
    if ('results' in result.payload) {
      throw new Error('Expected single-source ingest payload')
    }
    expect(result.payload.writtenFiles).toEqual(['wiki/sources/sample.md'])
    expect(cliMocks.runIngestCommand).toHaveBeenCalledTimes(1)
    expect(cliMocks.runIngestCommand).toHaveBeenCalledWith({
      knowledgeRoot: path.resolve('/tmp/llm-wiki-e2e'),
      input: path.resolve('tests/fixtures/inputs/sample.md'),
    })
  })

  it('maps natural-language synonyms onto the correct CLI commands', async () => {
    const initResult = await handleSkillIntent({
      intent: 'setup',
      knowledgeRoot: '/tmp/llm-wiki-skill-synonyms',
    })
    expect(initResult.command).toBe('init')
    if (initResult.command !== 'init') {
      throw new Error(`Expected init command, received ${initResult.command}`)
    }
    expect(initResult.status).toBe('initialized')
    expect(initResult.summary).toContain('Initialized knowledge root')
    expect(initResult.payload.createdDirectories).toContain('raw/inbox')

    const ingestResult = await handleSkillIntent({
      intent: 'import',
      knowledgeRoot: '/tmp/llm-wiki-skill-synonyms',
      input: 'tests/fixtures/inputs/sample.md',
    })
    expect(ingestResult.command).toBe('ingest')
    expect(ingestResult.summary).toContain('Ingest completed')

    const queryResult = await handleSkillIntent({
      intent: 'search',
      knowledgeRoot: '/tmp/llm-wiki-skill-synonyms',
      input: 'What is OpenClaw?',
    })
    expect(queryResult.command).toBe('query')
    if (queryResult.command !== 'query') {
      throw new Error(`Expected query command, received ${queryResult.command}`)
    }
    expect(queryResult.status).toBe('answered')
    expect(queryResult.summary).toContain('citation')
    expect(queryResult.payload.synthesisSuggestion).toBeTruthy()
    expect(queryResult.payload.synthesisSuggestion!.status).toBe('suggested')
  })

  it('maps ingest without an explicit source to raw/inbox ingestion', async () => {
    const result = await handleSkillIntent({
      intent: 'ingest',
      knowledgeRoot: '/tmp/llm-wiki-inbox',
    })

    expect(result.command).toBe('ingest')
    expect(result.status).toBe('inbox-ingested')
    expect(result.summary).toContain('inbox item')
    expect(cliMocks.runIngestInboxCommand).toHaveBeenCalledWith({
      knowledgeRoot: path.resolve('/tmp/llm-wiki-inbox'),
    })
    expect(cliMocks.runIngestCommand).not.toHaveBeenCalled()
  })

  it('normalizes knowledgeRoot and local source paths before delegating', async () => {
    const canonicalRoot = '/tmp/llm-wiki-normalized'
    const unnormalizedRoot = `${canonicalRoot}/../llm-wiki-normalized`

    await handleSkillIntent({
      intent: 'capture',
      knowledgeRoot: unnormalizedRoot,
      input: './tests/fixtures/inputs/sample.md',
    })

    expect(cliMocks.runIngestCommand).toHaveBeenCalledWith({
      knowledgeRoot: path.resolve(canonicalRoot),
      input: path.resolve('./tests/fixtures/inputs/sample.md'),
    })
  })

  it('delegates init, lint, and status with human-readable summaries', async () => {
    const initResult = await handleSkillIntent({
      intent: 'create root',
      knowledgeRoot: '/tmp/llm-wiki-facade-ops',
    })
    expect(initResult.command).toBe('init')
    if (initResult.command !== 'init') {
      throw new Error(`Expected init command, received ${initResult.command}`)
    }
    expect(initResult.status).toBe('initialized')
    expect(initResult.summary).toContain('Initialized knowledge root')

    const lintResult = await handleSkillIntent({
      intent: 'validate',
      knowledgeRoot: '/tmp/llm-wiki-facade-ops',
    })
    expect(lintResult.command).toBe('lint')
    if (lintResult.command !== 'lint') {
      throw new Error(`Expected lint command, received ${lintResult.command}`)
    }
    expect(lintResult.summary).toContain('Lint ok')
    expect(lintResult.payload.checkedFiles).toEqual(['wiki/sources/sample.md'])

    const statusResult = await handleSkillIntent({
      intent: 'show state',
      knowledgeRoot: '/tmp/llm-wiki-facade-ops',
    })
    expect(statusResult.command).toBe('status')
    if (statusResult.command !== 'status') {
      throw new Error(`Expected status command, received ${statusResult.command}`)
    }
    expect(statusResult.status).toBe('ready')
    expect(statusResult.summary).toContain('required directories present')
    expect(statusResult.summary).toContain('required files present')
    expect(statusResult.payload.requiredDirectories.missing).toEqual([])
    expect(statusResult.payload.requiredFiles.missing).toEqual([])
  })

  it('delegates save-synthesis with normalized args and human-readable summary', async () => {
    const result = await handleSkillIntent({
      intent: 'promote',
      knowledgeRoot: '/tmp/llm-wiki-promote',
      suggestionId: 'syn-1',
      confirm: true,
    })

    expect(result.command).toBe('save-synthesis')
    if (result.command !== 'save-synthesis') {
      throw new Error(`Expected save-synthesis command, received ${result.command}`)
    }
    expect(result.status).toBe('promoted')
    expect(result.summary).toContain('Promoted synthesis suggestion syn-1')
    expect(result.payload.pagePath).toBe('wiki/syntheses/syn-1.md')
    expect(cliMocks.runSaveSynthesisCommand).toHaveBeenCalledWith({
      knowledgeRoot: path.resolve('/tmp/llm-wiki-promote'),
      suggestionId: 'syn-1',
      confirm: true,
    })
  })

  it('rejects unsupported intents before delegating', async () => {
    await expect(
      handleSkillIntent({
        intent: 'dance',
        knowledgeRoot: '/tmp/llm-wiki-unsupported',
      }),
    ).rejects.toThrow('Unsupported skill intent: dance')

    expect(cliMocks.runInitCommand).not.toHaveBeenCalled()
    expect(cliMocks.runIngestCommand).not.toHaveBeenCalled()
    expect(cliMocks.runQueryCommand).not.toHaveBeenCalled()
  })

  it('requires non-empty input for query flows while ingest can default to raw/inbox', async () => {
    await expect(
      handleSkillIntent({
        intent: 'query',
        knowledgeRoot: '/tmp/llm-wiki-missing-question',
        input: '   ',
      }),
    ).rejects.toThrow('Skill intent "query" requires a non-empty input value.')

    expect(cliMocks.runQueryCommand).not.toHaveBeenCalled()
  })
})
