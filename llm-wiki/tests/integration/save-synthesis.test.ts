import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runQueryCommand, runSaveSynthesisCommand } from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function markSuggestionReviewed(filePath: string): Promise<void> {
  const rawSuggestion = await readFile(filePath, 'utf8')
  const suggestion = JSON.parse(rawSuggestion) as Record<string, unknown>

  await writeFile(
    filePath,
    JSON.stringify({
      ...suggestion,
      status: 'reviewed',
      reviewedAt: new Date().toISOString(),
      reviewer: 'integration-test',
    }, null, 2),
    'utf8',
  )
}

describe('save-synthesis', () => {
  it('does not create ingest-generated synthesis suggestions from unapproved semantic candidates', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    const ingestResult = await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const ingestSuggestionPath = ingestResult.reviewFiles.find((filePath) => filePath.includes(path.join('review', 'merge-candidates')))
    expect(ingestSuggestionPath).toBeUndefined()
  })

  it('promotes a reviewed synthesis suggestion into a durable wiki synthesis page', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })

    expect(answer.synthesisSuggestion).toBeTruthy()

    await expect(
      runSaveSynthesisCommand({
        knowledgeRoot,
        suggestionId: answer.synthesisSuggestion!.id,
      }),
    ).rejects.toThrow(/reviewed or confirmed/i)

    await markSuggestionReviewed(answer.synthesisSuggestion!.filePath)

    const promoted = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: answer.synthesisSuggestion!.id,
    })

    expect(promoted.promoted).toBe(true)
    expect(promoted.pagePath).toContain(path.join('wiki', 'syntheses'))
    await expect(access(promoted.pagePath)).resolves.toBeUndefined()

    const pageContent = await readFile(promoted.pagePath, 'utf8')
    expect(pageContent).toMatch(/Compiler Notes/i)
    expect(pageContent).toMatch(/## 引用/)
  })

  it('promotes distinct synthesis pages for multiple reviewed suggestions from the same primary page', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const firstAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })
    const secondAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for an architect review',
    })

    expect(firstAnswer.synthesisSuggestion).toBeTruthy()
    expect(secondAnswer.synthesisSuggestion).toBeTruthy()
    expect(firstAnswer.synthesisSuggestion!.slug).not.toBe(secondAnswer.synthesisSuggestion!.slug)

    for (const suggestionFilePath of [firstAnswer.synthesisSuggestion!.filePath, secondAnswer.synthesisSuggestion!.filePath]) {
      await markSuggestionReviewed(suggestionFilePath)
    }

    const firstPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: firstAnswer.synthesisSuggestion!.id,
    })
    const secondPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: secondAnswer.synthesisSuggestion!.id,
    })

    expect(firstPromotion.pagePath).not.toBe(secondPromotion.pagePath)

    const firstPageContent = await readFile(firstPromotion.pagePath, 'utf8')
    const secondPageContent = await readFile(secondPromotion.pagePath, 'utf8')

    expect(firstPageContent).toContain('Summarize Compiler Notes for a new teammate')
    expect(secondPageContent).toContain('Summarize Compiler Notes for an architect review')
    expect(firstPageContent).not.toContain('Summarize Compiler Notes for an architect review')
  })

  it('recomputes a deterministic unique slug when reviewed suggestions collide at promotion time', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const firstAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })
    const secondAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for an architect review',
    })

    const baseSlug = 'compiler-notes-query-synthesis'
    const expectedFallbackSlug = `${baseSlug}-${secondAnswer.synthesisSuggestion!.id.replace(/^synthesis-/, '')}`

    for (const suggestion of [firstAnswer.synthesisSuggestion!, secondAnswer.synthesisSuggestion!]) {
      const rawSuggestion = await readFile(suggestion.filePath, 'utf8')
      const parsedSuggestion = JSON.parse(rawSuggestion) as Record<string, unknown>

      await writeFile(
        suggestion.filePath,
        JSON.stringify({
          ...parsedSuggestion,
          slug: baseSlug,
          status: 'reviewed',
          reviewedAt: new Date().toISOString(),
          reviewer: 'integration-test',
        }, null, 2),
        'utf8',
      )
    }

    const firstPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: firstAnswer.synthesisSuggestion!.id,
    })
    const secondPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: secondAnswer.synthesisSuggestion!.id,
    })

    expect(firstPromotion.pagePath).not.toBe(secondPromotion.pagePath)

    const firstPageContent = await readFile(firstPromotion.pagePath, 'utf8')
    const secondPageContent = await readFile(secondPromotion.pagePath, 'utf8')

    expect(firstPageContent).toContain('Summarize Compiler Notes for a new teammate')
    expect(secondPageContent).toContain('Summarize Compiler Notes for an architect review')
    expect(firstPageContent).not.toContain('Summarize Compiler Notes for an architect review')

    const promotedSecondSuggestion = JSON.parse(
      await readFile(secondAnswer.synthesisSuggestion!.filePath, 'utf8'),
    ) as { slug: string; pagePath: string }

    expect(promotedSecondSuggestion.slug).toBe(expectedFallbackSlug)
    expect(promotedSecondSuggestion.pagePath).toBe(secondPromotion.pagePath)

    const indexContent = await readFile(firstPromotion.indexPath, 'utf8')
    const logContent = await readFile(secondPromotion.logPath, 'utf8')

    expect(indexContent).toContain(`[[syntheses/${baseSlug}|Compiler Notes synthesis suggestion]]`)
    expect(indexContent).toContain(`[[syntheses/${expectedFallbackSlug}|Compiler Notes synthesis suggestion]]`)
    expect(logContent).toContain(`\\"slug\\":\\"${expectedFallbackSlug}\\"`)
  })

  it('fails loudly when both the requested slug and deterministic fallback slug are already occupied', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const firstAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })
    const secondAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for an architect review',
    })

    const baseSlug = 'compiler-notes-query-synthesis'
    const expectedFallbackSlug = `${baseSlug}-${secondAnswer.synthesisSuggestion!.id.replace(/^synthesis-/, '')}`

    for (const suggestion of [firstAnswer.synthesisSuggestion!, secondAnswer.synthesisSuggestion!]) {
      const rawSuggestion = await readFile(suggestion.filePath, 'utf8')
      const parsedSuggestion = JSON.parse(rawSuggestion) as Record<string, unknown>

      await writeFile(
        suggestion.filePath,
        JSON.stringify({
          ...parsedSuggestion,
          slug: baseSlug,
          status: 'reviewed',
          reviewedAt: new Date().toISOString(),
          reviewer: 'integration-test',
        }, null, 2),
        'utf8',
      )
    }

    await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: firstAnswer.synthesisSuggestion!.id,
    })

    const fallbackPath = path.join(knowledgeRoot, 'wiki', 'syntheses', `${expectedFallbackSlug}.md`)
    await writeFile(fallbackPath, '# Existing fallback page\n\n- Promotion source: another-suggestion\n', 'utf8')

    await expect(
      runSaveSynthesisCommand({
        knowledgeRoot,
        suggestionId: secondAnswer.synthesisSuggestion!.id,
      }),
    ).rejects.toThrow(new RegExp(`page slug collision for \"${baseSlug}\" also conflicts at \"${expectedFallbackSlug}\"`, 'i'))

    await expect(readFile(fallbackPath, 'utf8')).resolves.toContain('another-suggestion')
  })

  it('repairs stale promotion metadata when rerun finds the final page already owned by the same suggestion', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })

    await markSuggestionReviewed(answer.synthesisSuggestion!.filePath)

    const firstPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: answer.synthesisSuggestion!.id,
    })

    const suggestionPath = path.join(knowledgeRoot, 'review', 'queue', `${answer.synthesisSuggestion!.id}.json`)
    const rawPromotedSuggestion = await readFile(suggestionPath, 'utf8')
    const promotedSuggestion = JSON.parse(rawPromotedSuggestion) as Record<string, unknown>
    const repairedIndexEntry = `- [[syntheses/${answer.synthesisSuggestion!.slug}|Compiler Notes synthesis suggestion]]`

    await writeFile(
      suggestionPath,
      JSON.stringify({
        ...promotedSuggestion,
        status: 'reviewed',
        promotedAt: undefined,
        pagePath: undefined,
        updatedAt: new Date().toISOString(),
      }, null, 2),
      'utf8',
    )

    await writeFile(firstPromotion.indexPath, '# Wiki Index\n\n- [[sources/compiler-notes|Compiler Notes]]\n', 'utf8')
    await writeFile(firstPromotion.logPath, '# Wiki Log\n\n', 'utf8')

    const rerunPromotion = await runSaveSynthesisCommand({
      knowledgeRoot,
      suggestionId: answer.synthesisSuggestion!.id,
    })

    expect(rerunPromotion.pagePath).toBe(firstPromotion.pagePath)

    const rerunSuggestion = JSON.parse(await readFile(suggestionPath, 'utf8')) as {
      status: string
      pagePath?: string
      promotedAt?: string
    }
    const repairedIndexContent = await readFile(firstPromotion.indexPath, 'utf8')
    const repairedLogContent = await readFile(firstPromotion.logPath, 'utf8')
    const targetContent = await readFile(firstPromotion.pagePath, 'utf8')

    expect(rerunSuggestion.status).toBe('promoted')
    expect(rerunSuggestion.pagePath).toBe(firstPromotion.pagePath)
    expect(rerunSuggestion.promotedAt).toEqual(expect.any(String))
    expect(repairedIndexContent).toContain(repairedIndexEntry)
    expect(repairedLogContent).toContain(`\\"suggestionId\\":\\"${answer.synthesisSuggestion!.id}\\"`)
    expect(targetContent).toContain(`- Promotion source: ${answer.synthesisSuggestion!.id}`)
    expect(targetContent).toContain('Summarize Compiler Notes for a new teammate')
  })

  it('fails loudly instead of overwriting a page that appears at the final commit boundary', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })

    await markSuggestionReviewed(answer.synthesisSuggestion!.filePath)

    const targetPath = path.join(knowledgeRoot, 'wiki', 'syntheses', `${answer.synthesisSuggestion!.slug}.md`)
    let injectedConcurrentWrite = false

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

      return {
        ...actual,
        writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
          const [filePath, data, options] = args
          const result = await actual.writeFile(filePath, data, options)

          if (
            !injectedConcurrentWrite
            && typeof filePath === 'string'
            && filePath.startsWith(`${targetPath}.`)
            && filePath.endsWith('.tmp')
          ) {
            injectedConcurrentWrite = true
            await actual.writeFile(targetPath, '# Concurrent page\n\n- Promotion source: concurrent-writer\n', 'utf8')
          }

          return result
        },
      }
    })

    const { runSaveSynthesis } = await import('../../src/query/save-synthesis.js')

    await expect(
      runSaveSynthesis({
        knowledgeRoot,
        suggestionId: answer.synthesisSuggestion!.id,
      }),
    ).rejects.toThrow(/final commit|already exists|appeared/i)

    const targetContent = await readFile(targetPath, 'utf8')
    expect(targetContent).toContain('concurrent-writer')
    expect(targetContent).not.toContain('Summarize Compiler Notes for a new teammate')
  })

  it('rejects unsafe synthesis slugs before writing outside wiki/syntheses', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-save-synthesis-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'Summarize Compiler Notes for a new teammate',
    })

    const rawSuggestion = await readFile(answer.synthesisSuggestion!.filePath, 'utf8')
    const suggestion = JSON.parse(rawSuggestion) as Record<string, unknown>
    await writeFile(
      answer.synthesisSuggestion!.filePath,
      JSON.stringify({
        ...suggestion,
        slug: '../../escape-target/bad',
        status: 'reviewed',
        reviewedAt: new Date().toISOString(),
        reviewer: 'integration-test',
      }, null, 2),
      'utf8',
    )

    await expect(
      runSaveSynthesisCommand({
        knowledgeRoot,
        suggestionId: answer.synthesisSuggestion!.id,
      }),
    ).rejects.toThrow(/invalid synthesis slug/i)

    await expect(readFile(path.join(knowledgeRoot, 'escape-target', 'bad.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
