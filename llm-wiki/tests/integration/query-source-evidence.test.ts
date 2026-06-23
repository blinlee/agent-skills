import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runCliMain, runIngestCommand, runInitCommand, runLintCommand, runQueryCommand, runQueryReadinessCommand, runStatusCommand, runWikiOverviewCommand } from '../../src/cli.js'
import { buildQueryIntent, type QueryIntentProfile } from '../../src/query/intent.js'
import { retrieveChunks } from '../../src/retrieval/retrieval.js'
import { runIngestCommandWithCuration, writeTestQualityPlan } from '../helpers/curation.js'

const tempRoots: string[] = []

const financeQueryProfiles: QueryIntentProfile[] = [
  {
    domain: 'wiki:ai-finance',
    core: ['AI finance', '量化研究', 'quantitative research', 'portfolio construction', 'factor discovery'],
    support: ['financial time-series', 'market evidence', 'trading', 'risk control'],
    generic: ['AI', 'research', 'model'],
    negative: ['wiki:software-engineering'],
    focus: ['量化研究', 'quantitative research', 'portfolio', 'factor discovery'],
  },
  {
    domain: 'wiki:software-engineering',
    core: ['software engineering', 'coding agents', 'tool use', 'evaluation harnesses'],
    support: ['prompt workflows', 'task decomposition'],
    generic: ['AI', 'agent', 'evaluation'],
    negative: ['wiki:ai-finance'],
    focus: ['software engineering', 'coding agents'],
  },
]

afterEach(async () => {
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `no-embedding-config-${Date.now()}.json`))
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

function semanticVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('量化')
    || normalized.includes('quantitative research')
    || normalized.includes('factor discovery')
    || normalized.includes('portfolio')
  ) {
    return [1, 0]
  }
  return [0, 1]
}

function semanticDecoyVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized.includes('量化')) {
    return [1, 0]
  }
  if (normalized.includes('ai software engineering') || normalized.includes('coding agents') || normalized.includes('prompt workflows')) {
    return [0.58, 0.814616]
  }
  return [0, 1]
}

async function qualifySampleCompilerNotesLinks(knowledgeRoot: string): Promise<void> {
  const rewriteIfPresent = async (filePath: string, rewrite: (content: string) => string) => {
    try {
      const content = await readFile(filePath, 'utf8')
      const nextContent = rewrite(content)
      if (nextContent !== content) {
        await writeFile(filePath, nextContent, 'utf8')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'),
    (content) => content.replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'),
    (content) => content.replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'),
    (content) => content
      .replace('[[openclaw|OpenClaw]]', '[[entities/openclaw|OpenClaw]]')
      .replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
}

describe('query source evidence retrieval', () => {
  it('answers from wiki/index.md and reports healthy status', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await qualifySampleCompilerNotesLinks(knowledgeRoot)

    const status = await runStatusCommand({ knowledgeRoot })
    const lint = await runLintCommand({ knowledgeRoot })
    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is Compiler Notes?',
    })

    expect(status.knowledgeRootExists).toBe(true)
    expect(status.requiredDirectories.missing).toEqual([])
    expect(status.requiredFiles.missing).toEqual([])
    expect(lint.status).toBe('ok')
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.retrieval.mode).toBe('matched')
    expect(answer.retrieval.signalSummary.hitCount).toBeGreaterThan(0)
    expect(answer.retrieval.signalSummary.confidence.lowConfidence).toBe(false)
    expect(['medium', 'high']).toContain(answer.retrieval.signalSummary.confidence.level)
    expect(answer.agentReadingPack).toEqual(expect.objectContaining({
      answerability: 'answered',
      retrievalMode: 'matched',
      citationCount: answer.citations.length,
      mustReadFurther: true,
    }))
    expect(answer.agentReadingPack.citationsToRead[0]).toEqual(expect.objectContaining({
      citationIndex: 1,
      title: expect.any(String),
      filePath: expect.any(String),
      rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
      evidenceKind: 'raw',
    }))
    expect(answer.agentReadingPack.citationsToRead[0]!.filePath).toBe(answer.agentReadingPack.citationsToRead[0]!.rawPath)
    expect(answer.answer).toMatch(/Compiler Notes/i)
    expect(answer.synthesisSuggestion).toBeTruthy()
    await expect(access(answer.synthesisSuggestion!.filePath)).resolves.toBeUndefined()
  })

  it('expands matched source chunks into readable parent or neighbor original-source passages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-pack-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'source-pack.md')
    const earlier = 'EARLIER_PARENT_CONTEXT explains the setup before the key claim. '.repeat(8)
    const target = 'TARGET_UNIQUE_SIGNAL says the retrieval answer needs surrounding source context, not a tiny isolated excerpt. '.repeat(5)
    const later = 'LATER_PARENT_CONTEXT records the downstream implication after the key claim. '.repeat(8)
    await writeFile(sourcePath, `# Source Pack Study\n\n## Evidence Section\n\n${earlier}\n\n${target}\n\n${later}\n`, 'utf8')

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      qualityPath: await writeTestQualityPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        quote: 'TARGETUNIQUESIGNAL says the retrieval answer needs surrounding source context',
      }),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What does TARGET_UNIQUE_SIGNAL say about source context?',
    })
    const passage = answer.sourceReadingPack.passages[0]!

    expect(answer.grounding.answerability).toBe('answered')
    expect(passage.rawPath).toContain(`${path.sep}raw${path.sep}`)
    expect(passage.text).toContain('explains the setup before the key claim')
    expect(passage.text).toContain('retrieval answer needs surrounding source context')
    expect(passage.text).toContain('records the downstream implication after the key claim')
    expect(passage.stitchedFromChunkIds.length).toBeGreaterThan(1)
    expect(passage.text.length).toBeGreaterThan(answer.citations[0]!.excerpt.length)
  })

  it('uses raw-backed semantic hits for Chinese questions over English source passages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-zh-en-semantic-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    const configPath = path.join(knowledgeRoot, 'embedding-config.json')
    tempRoots.push(knowledgeRoot, inputRoot)
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'semantic-test',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] }
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
      return new Response(JSON.stringify({
        data: inputs.map((input, index) => ({ index, embedding: semanticVectorFor(String(input)) })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const sourcePath = path.join(inputRoot, 'ai-quant-frameworks.md')
    await writeFile(sourcePath, [
      '# AI Quantitative Research Frameworks',
      '',
      'AI-based quantitative research is organized around four major routes: factor discovery with machine learning, time-series forecasting with deep sequence models, agentic research assistants for idea generation, and portfolio or execution optimization with reinforcement learning.',
      '',
      'The framework separates data engineering, feature research, model validation, portfolio construction, and risk control so each route can be tested against market evidence.',
    ].join('\n'), 'utf8')

    await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
      queryIntent: buildQueryIntent('基于AI的量化研究现在主要框架是怎样的，哪几种路线？', financeQueryProfiles, { readingMode: 'document' }),
    })

    expect(answer.retrieval.signalSummary.signalCounts.embedding).toBeGreaterThan(0)
    expect(answer.grounding.answerability).toBe('answered')
    expect(answer.citations[0]).toEqual(expect.objectContaining({
      rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
      retrievalScore: expect.objectContaining({ embedding: expect.any(Number) }),
    }))
    expect(answer.sourceReadingPack.passages[0]!.text).toContain('AI-based quantitative research')
  })

  it('does not answer a finance question from weak embedding-only software-engineering evidence', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-weak-semantic-decoy-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    const configPath = path.join(knowledgeRoot, 'embedding-config.json')
    tempRoots.push(knowledgeRoot, inputRoot)
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'semantic-decoy-test',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] }
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
      return new Response(JSON.stringify({
        data: inputs.map((input, index) => ({ index, embedding: semanticDecoyVectorFor(String(input)) })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const sourcePath = path.join(inputRoot, 'ai-software-engineering.md')
    await writeFile(sourcePath, [
      '# AI Software Engineering Notes',
      '',
      'AI software engineering discusses coding agents, tool use, task decomposition, prompt workflows, and evaluation harnesses.',
    ].join('\n'), 'utf8')
    await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
      queryIntent: buildQueryIntent('基于AI的量化研究现在主要框架是怎样的，哪几种路线？', financeQueryProfiles, { readingMode: 'document' }),
    })

    expect(answer.retrieval.signalSummary.signalCounts.embedding).toBeGreaterThan(0)
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.sourceReadingPack.answerability).toBe('insufficient-evidence')
  })

  it('returns an explicit no-match response instead of fabricating an answer from the first source page', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is flibbertigibbet quantum umbrella?',
    })

    expect(answer.answer).toMatch(/没有在当前索引的 wiki 中找到足够证据/)
    expect(answer.citations).toEqual([])
    expect(answer.retrieval.mode).toBe('no-match')
    expect(answer.retrieval.signalSummary.hitCount).toBe(0)
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.grounding.selectedCitationCount).toBe(0)
    expect(answer.grounding.claims).toEqual([])
    expect(answer.grounding.conflicts).toEqual([])
    expect(answer.agentReadingPack).toEqual(expect.objectContaining({
      answerability: 'insufficient-evidence',
      retrievalMode: 'no-match',
      embeddingUsed: false,
      citationCount: 0,
      mustReadFurther: false,
      citationsToRead: [],
    }))
    expect(answer.synthesisSuggestion).toBeNull()
  })

  it('downgrades boilerplate-only weak retrieval hits to insufficient evidence', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-low-confidence-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'boilerplate-card.md'),
      [
        '---',
        'title: "Boilerplate Card"',
        'created: "2026-06-19T00:00:00.000Z"',
        'updated: "2026-06-19T00:00:00.000Z"',
        'type: "source"',
        'tags: []',
        'sources: []',
        'confidence: "medium"',
        'contested: false',
        '---',
        '# Boilerplate Card',
        '',
        '## Summary',
        'Source type: note.',
        'The only matching token is boilerplate.',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'index.md'),
      '# Wiki 索引\n\n## 来源\n- [[sources/boilerplate-card|Boilerplate Card]]\n',
      'utf8',
    )
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({ knowledgeRoot, question: 'boilerplate' })

    expect(answer.retrieval.mode).toBe('matched')
    expect(answer.retrieval.signalSummary.confidence.lowConfidence).toBe(true)
    expect(answer.retrieval.signalSummary.confidence.reasons).toContain('boilerplate-penalty')
    expect(answer.retrieval.messages.join('\n')).toContain('retrieval confidence low')
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.answer).toMatch(/没有在当前索引的 wiki 中找到足够证据/)
    expect(answer.synthesisSuggestion).toBeNull()
  })

  it('does not match boilerplate evidence-preservation chunks for absent-topic phrasing', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What does the wiki say about a topic that is not present: quantum lobster poetry compiler?',
    })

    expect(answer.answer).toMatch(/没有在当前索引的 wiki 中找到足够证据/)
    expect(answer.citations).toEqual([])
    expect(answer.retrieval.mode).toBe('no-match')
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.synthesisSuggestion).toBeNull()
  })

  it('reports retrieval coverage reasons for accepted lexical hits', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })

    const result = await retrieveChunks({
      knowledgeRoot,
      question: 'deterministic compiler knowledge pipeline',
    })

    expect(result.mode).toBe('matched')
    expect(result.hits[0].reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^coverage:/),
    ]))
  })

  it('excludes review proposal chunks by default and includes them only when requested', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-retrieval-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await mkdir(path.join(knowledgeRoot, 'review', 'queue'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'review', 'queue', 'review-special.json'), JSON.stringify({
      id: 'review-special',
      title: 'Review-only Falcon Calibration',
      status: 'proposed',
      evidence: ['falcon calibration review evidence should not enter default answers'],
      reviewQuestions: ['Should this review-only material be accepted?'],
    }, null, 2), 'utf8')
    await runBuildIndexCommand({ knowledgeRoot })

    const defaultAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'falcon calibration review evidence',
    })
    const reviewAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'falcon calibration review evidence',
      includeReview: true,
    })

    expect(defaultAnswer.citations.map((citation) => citation.target)).not.toContain('review/queue/review-special')
    expect(JSON.stringify(defaultAnswer)).not.toContain('falcon calibration review evidence should not enter default answers')
    expect(defaultAnswer.retrieval.messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/review\/proposal chunks excluded by default/),
    ]))
    expect(reviewAnswer.retrieval.mode).toBe('matched')
    expect(reviewAnswer.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'review/queue/review-special' }),
    ]))
  })

  it('filters private and sensitive chunks from default retrieval evidence', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-sensitive-retrieval-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    const sourceDir = path.join(knowledgeRoot, 'wiki', 'sources')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'public-rag.md'), [
      '---',
      'title: "Public RAG Note"',
      'created: "2026-06-13"',
      'updated: "2026-06-13"',
      'type: "source"',
      'tags: ["rag"]',
      'sources: ["fixture"]',
      '---',
      '# Public RAG Note',
      '',
      'Public retrieval evidence says citation budgets reduce retrieval noise.',
    ].join('\n'), 'utf8')
    await writeFile(path.join(sourceDir, 'private-rag.md'), [
      '---',
      'title: "Private RAG Secret"',
      'created: "2026-06-13"',
      'updated: "2026-06-13"',
      'type: "source"',
      'tags: ["rag"]',
      'sources: ["fixture"]',
      'privacy: "private"',
      '---',
      '# Private RAG Secret',
      '',
      'PRIVATE_TOKEN_XYZ is a private retrieval secret and must not appear in query evidence.',
    ].join('\n'), 'utf8')
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'index.md'),
      '# Wiki 索引\n\n- [[sources/public-rag|Public RAG Note]]\n- [[sources/private-rag|Private RAG Secret]]\n',
      'utf8',
    )
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What says private retrieval secret PRIVATE_TOKEN_XYZ?',
    })

    expect(answer.retrieval.messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/private\/sensitive chunks excluded by default: 1/),
    ]))
    expect(answer.question).toContain('[REDACTED]')
    expect(answer.answer).toContain('[REDACTED]')
    expect(JSON.stringify(answer)).not.toContain('PRIVATE_TOKEN_XYZ')
    expect(answer.citations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'sources/private-rag' }),
    ]))
  })

  it('can select a relevant page by indexed page content rather than title alone', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.retrieval.mode).toBe('matched')
    expect(answer.retrieval.signalSummary.hitCount).toBe(answer.citations.length)
    expect(answer.retrieval.signalSummary.signalCounts.lexical).toBeGreaterThan(0)
    expect(answer.retrieval.signalSummary.sourceCounts.rawEvidence + answer.retrieval.signalSummary.sourceCounts.wikiDerived).toBe(answer.citations.length)
    expect(answer.grounding.answerability).toBe('answered')
    expect(answer.grounding.selectedCitationCount).toBe(answer.citations.length)
    expect(answer.grounding.citedChunkIds.length).toBeGreaterThan(0)
    expect(answer.grounding.claims.length).toBeGreaterThan(0)
    expect(answer.grounding.claims[0]).toEqual(expect.objectContaining({ citationIndexes: [1] }))
    expect(answer.answer).toMatch(/deterministic|knowledge pipeline|Compiler Notes/i)
    expect(answer.answer).toMatch(/第 \d+-\d+ 行/)
    expect(answer.answer).toContain('证据范围')
    expect(answer.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'sources/compiler-notes',
        chunkId: expect.stringMatching(/^sha256:/),
        heading: expect.any(String),
        headingPath: expect.any(Array),
        startLine: expect.any(Number),
        endLine: expect.any(Number),
        sourceRef: expect.any(String),
        rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
        evidenceKind: 'raw',
        excerpt: expect.stringMatching(/deterministic|knowledge pipeline|Compiler Notes/i),
      }),
    ]))
  })
})
