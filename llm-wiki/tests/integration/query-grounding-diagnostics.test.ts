import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runCliMain, runIngestCommand, runInitCommand, runLintCommand, runQueryCommand, runQueryReadinessCommand, runStatusCommand, runWikiOverviewCommand } from '../../src/cli.js'
import { retrieveChunks } from '../../src/retrieval/retrieval.js'
import { runIngestCommandWithCuration } from '../helpers/curation.js'

const tempRoots: string[] = []

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

describe('query grounding diagnostics', () => {
  it('does not persist synthesis suggestions for other low-confidence retrieval hits', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-low-confidence-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'thin-note.md'),
      '# Thin Note\n\nLonelySignal appears in a derived wiki-only note without raw source provenance.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'index.md'),
      '# Wiki 索引\n\n## 来源\n- [[sources/thin-note|Thin Note]]\n',
      'utf8',
    )
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({ knowledgeRoot, question: 'LonelySignal' })

    expect(answer.retrieval.mode).toBe('matched')
    expect(answer.retrieval.signalSummary.confidence.lowConfidence).toBe(true)
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.synthesisSuggestion).toBeNull()
  })

  it('extracts question-relevant sentence claims instead of using whole citation excerpts as claims', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-claim-grounding-'))
    tempRoots.push(knowledgeRoot)

    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-claim-inputs-'))
    tempRoots.push(inputRoot)
    const sourcePath = path.join(inputRoot, 'claim-source.md')

    await writeFile(
      sourcePath,
      '# Compiler Claims\n\nThe compiler pipeline keeps parsing deterministic. Unrelated deployment notes describe packaging. Grounded citations preserve source line spans for audit.\n',
      'utf8',
    )

    await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'How does the compiler pipeline keep parsing deterministic?',
    })

    expect(answer.grounding.claims.length).toBeGreaterThan(0)
    expect(answer.grounding.claims[0]).toEqual(expect.objectContaining({ citationIndexes: [1] }))
    expect(answer.grounding.claims[0].text).toMatch(/compiler pipeline keeps parsing deterministic/i)
    expect(answer.grounding.claims[0].text).not.toMatch(/Unrelated deployment notes/i)
  })

  it('records conflict signals in grounded query diagnostics', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-conflict-grounding-'))
    tempRoots.push(knowledgeRoot)
    const sourcePath = path.join(knowledgeRoot, 'conflict-source.md')
    await writeFile(sourcePath, [
      '# Compiler Notes',
      '',
      'Entity: OpenClaw',
      'Concept: compilation',
      '',
      'OpenClaw keeps compilation deterministic across the knowledge pipeline.',
      'This compiler pipeline note is outdated and conflicts with newer implementation evidence.',
      '',
    ].join('\n'), 'utf8')

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
    })
    await runBuildIndexCommand({ knowledgeRoot })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'compiler pipeline outdated conflicts newer implementation evidence',
    })

    expect(answer.grounding.conflictCount).toBeGreaterThan(0)
    expect(answer.grounding.conflicts[0]).toEqual(expect.objectContaining({
      citationIndex: expect.any(Number),
      kind: expect.stringMatching(/conflict|stale/),
      severity: expect.stringMatching(/high|medium/),
      reason: expect.stringMatching(/conflict|stale/),
      matchedText: expect.any(String),
      target: 'sources/compiler-notes',
    }))
    expect(answer.answer).toMatch(/人工复核/)
  })
})
