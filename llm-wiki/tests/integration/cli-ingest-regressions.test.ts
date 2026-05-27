import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runLintCommand, runQueryCommand } from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('cli ingest regressions', () => {
  it('persists a terminal failure instead of leaving a missing local file job running', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    const result = await runIngestCommand({
      knowledgeRoot,
      input: path.join(os.tmpdir(), 'definitely-missing-llm-wiki.md'),
    })

    expect(result.status).toBe('failed_terminal')
    expect(result.rejectedPath).toContain(path.join('raw', 'rejected'))
    await expect(access(result.rejectedPath!)).resolves.toBeUndefined()

    const jobs = await readJobs(knowledgeRoot)
    expect(jobs[result.jobId]?.status).toBe('failed_terminal')
  })

  it('keeps same-title source pages distinct instead of overwriting the first source', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourceA = path.join(inputRoot, 'alpha-source.md')
    const sourceB = path.join(inputRoot, 'beta-source.md')

    await writeFile(sourceA, '# Shared Notes\n\nEntity: AlphaTeam\nConcept: reliability\n\nAlphaTeam keeps reliability visible.\n', 'utf8')
    await writeFile(sourceB, '# Shared Notes\n\nEntity: BetaTeam\nConcept: observability\n\nBetaTeam keeps observability visible.\n', 'utf8')

    await runIngestCommand({ knowledgeRoot, input: sourceA })
    const second = await runIngestCommand({ knowledgeRoot, input: sourceB })

    const sourceFiles = (await readDedupManifest(knowledgeRoot))
    const firstSourcePages = sourceFiles.entries[path.resolve(sourceA)]?.lastOutputManifest?.pageFiles.filter((file) => file.startsWith('wiki/sources/'))
    const secondSourcePages = sourceFiles.entries[path.resolve(sourceB)]?.lastOutputManifest?.pageFiles.filter((file) => file.startsWith('wiki/sources/'))

    expect(firstSourcePages).toEqual(['wiki/sources/shared-notes.md'])
    expect(secondSourcePages).toHaveLength(1)
    expect(secondSourcePages?.[0]).not.toBe(firstSourcePages?.[0])

    const firstContent = await readFile(path.join(knowledgeRoot, firstSourcePages![0]!), 'utf8')
    const secondContent = await readFile(path.join(knowledgeRoot, secondSourcePages![0]!), 'utf8')

    expect(firstContent).toContain('AlphaTeam')
    expect(secondContent).toContain('BetaTeam')
    expect(second.status).toMatch(/completed|needs_review|partial/)
  })

  it('keeps parallel ingests against one knowledge root crash-free and fully persisted', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourceA = path.join(inputRoot, 'alpha.md')
    const sourceB = path.join(inputRoot, 'beta.md')

    await Promise.all([
      writeFile(sourceA, '# Parallel Alpha\n\nEntity: Alpha Engine\nConcept: scheduling\n\nAlpha Engine keeps scheduling reliable.\n', 'utf8'),
      writeFile(sourceB, '# Parallel Beta\n\nEntity: Beta Engine\nConcept: orchestration\n\nBeta Engine keeps orchestration reliable.\n', 'utf8'),
    ])

    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000)

    const [first, second] = await Promise.all([
      runIngestCommand({ knowledgeRoot, input: sourceA }),
      runIngestCommand({ knowledgeRoot, input: sourceB }),
    ])

    expect(first.status).toMatch(/completed|needs_review|partial/)
    expect(second.status).toMatch(/completed|needs_review|partial/)

    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'parallel-alpha.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'parallel-beta.md'))).resolves.toBeUndefined()

    const jobs = await readJobs(knowledgeRoot)
    expect(Object.keys(jobs)).toHaveLength(2)
    expect(jobs[first.jobId]?.status).toBe(first.status)
    expect(jobs[second.jobId]?.status).toBe(second.status)

    const dedupManifest = await readDedupManifest(knowledgeRoot)
    expect(dedupManifest.entries[path.resolve(sourceA)]).toMatchObject({
      lastSuccessfulJobId: first.jobId,
    })
    expect(dedupManifest.entries[path.resolve(sourceB)]).toMatchObject({
      lastSuccessfulJobId: second.jobId,
    })
  })

  it('keeps candidate semantics in proposals while removing source-owned stale outputs on changed-source recompiles', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourceAPath = path.join(inputRoot, 'alpha-notes.md')
    const sourceBPath = path.join(inputRoot, 'beta-notes.md')

    await writeFile(
      sourceAPath,
      '# alpha notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw keeps reliability high.\n',
      'utf8',
    )
    await writeFile(
      sourceBPath,
      '# beta notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw documents reliability work.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourceBPath })
    const second = await runIngestCommand({ knowledgeRoot, input: sourceAPath })
    expect(first.status).toBe('needs_review')
    expect(second.status).toBe('needs_review')

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'beta-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(
      sourceAPath,
      '# alpha digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability high.\n',
      'utf8',
    )

    const recompiled = await runIngestCommand({ knowledgeRoot, input: sourceAPath })
    expect(recompiled.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(recompiled.status).toBe('needs_review')

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-notes-synthesis.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-digest-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'beta-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).not.toContain('[[entities/openclaw|OpenClaw]]')
    expect(indexContent).not.toContain('[[concepts/reliability|Reliability]]')
    expect(indexContent).not.toContain('[[entities/graphops|GraphOps]]')
    expect(indexContent).not.toContain('[[concepts/stability|Stability]]')
    expect(indexContent).toContain('[[sources/alpha-digest|alpha digest]]')
    expect(indexContent).toContain('[[sources/beta-notes|beta notes]]')
    expect(indexContent).not.toContain('[[sources/alpha-notes|alpha notes]]')
    expect(indexContent).not.toContain('[[syntheses/alpha-digest-synthesis|GraphOps × Stability]]')
    expect(indexContent).not.toContain('[[syntheses/beta-notes-synthesis|OpenClaw × Reliability]]')
    expect(indexContent).not.toContain('[[syntheses/alpha-notes-synthesis|OpenClaw × Reliability]]')

    const dedupManifest = await readDedupManifest(knowledgeRoot)
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest).toMatchObject({
      pageFiles: expect.arrayContaining([
        'wiki/sources/alpha-digest.md',
      ]),
      indexEntries: expect.arrayContaining([
        '- [[sources/alpha-digest|alpha digest]]',
      ]),
    })
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/entities/openclaw.md')
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/concepts/reliability.md')
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/syntheses/alpha-digest-synthesis.md')
    expect(dedupManifest.entries[path.resolve(sourceBPath)]?.lastOutputManifest?.pageFiles).toEqual(expect.arrayContaining([
      'wiki/sources/beta-notes.md',
    ]))
    expect(dedupManifest.entries[path.resolve(sourceBPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/syntheses/beta-notes-synthesis.md')
  })

  it('keeps legacy snapshot handling source-owned after one owner changes', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourceAPath = path.join(inputRoot, 'alpha-notes.md')
    const sourceBPath = path.join(inputRoot, 'beta-notes.md')

    await writeFile(
      sourceAPath,
      '# alpha notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw keeps reliability high.\n',
      'utf8',
    )
    await writeFile(
      sourceBPath,
      '# beta notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw documents reliability work.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourceBPath })
    const second = await runIngestCommand({ knowledgeRoot, input: sourceAPath })
    expect(first.status).toBe('needs_review')
    expect(second.status).toBe('needs_review')

    await removeStoredPageSnapshots(knowledgeRoot, sourceAPath)
    await removeStoredPageSnapshots(knowledgeRoot, sourceBPath)

    await writeFile(
      sourceAPath,
      '# alpha digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability high.\n',
      'utf8',
    )

    const recompiled = await runIngestCommand({ knowledgeRoot, input: sourceAPath })
    expect(recompiled.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(recompiled.status).toBe('needs_review')

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).not.toContain('[[entities/openclaw|OpenClaw]]')
    expect(indexContent).not.toContain('[[concepts/reliability|Reliability]]')
    expect(indexContent).not.toContain('[[entities/graphops|GraphOps]]')
    expect(indexContent).not.toContain('[[concepts/stability|Stability]]')
    expect(indexContent).toContain('[[sources/alpha-digest|alpha digest]]')
    expect(indexContent).toContain('[[sources/beta-notes|beta notes]]')
    expect(indexContent).not.toContain('[[sources/alpha-notes|alpha notes]]')

    const lint = await runLintCommand({ knowledgeRoot })
    expect(lint.status).toBe('ok')

    const openClawQuery = await runQueryCommand({
      knowledgeRoot,
      question: 'What is OpenClaw?',
    })
    expect(openClawQuery.citations.map((citation) => citation.target)).toEqual(
      expect.arrayContaining(['sources/beta-notes']),
    )
  })

  it('skips unchanged repo inputs and recompiles when shallow repo content changes', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-repo-'))
    tempRoots.push(knowledgeRoot, repoRoot)

    await mkdir(path.join(repoRoot, 'docs'), { recursive: true })
    await writeFile(
      path.join(repoRoot, 'README.md'),
      '# Repo Safety\n\nEntity: OpenClaw\nConcept: platform\n\nOpenClaw keeps the platform reliable.\n',
      'utf8',
    )
    await writeFile(path.join(repoRoot, 'docs', 'overview.md'), 'The repo contains stable docs.\n', 'utf8')

    const first = await runIngestCommand({ knowledgeRoot, input: repoRoot })
    const second = await runIngestCommand({ knowledgeRoot, input: repoRoot })

    expect(first.dedupDecision).toEqual({ action: 'compile', reason: 'first-seen' })
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(second.writtenFiles).toEqual([])

    await writeFile(
      path.join(repoRoot, 'docs', 'overview.md'),
      'The repo now documents GraphOps stability.\n\nEntity: GraphOps\nConcept: stability\n',
      'utf8',
    )

    const third = await runIngestCommand({ knowledgeRoot, input: repoRoot })

    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips unchanged url inputs and recompiles when fetched content changes', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    let currentHtml = [
      '<html>',
      '  <head><title>URL Dedup Sample</title></head>',
      '  <body>',
      '    <article>',
      '      <h1>URL Dedup Sample</h1>',
      '      <p>Entity: OpenClaw</p>',
      '      <p>Concept: routing</p>',
      '      <p>OpenClaw keeps routing predictable.</p>',
      '    </article>',
      '  </body>',
      '</html>',
    ].join('\n')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => currentHtml,
      } satisfies Partial<Response> as Response)),
    )

    const url = 'https://example.com/url-dedup-sample'
    const first = await runIngestCommand({ knowledgeRoot, input: url })
    const second = await runIngestCommand({ knowledgeRoot, input: url })

    expect(first.dedupDecision).toEqual({ action: 'compile', reason: 'first-seen' })
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(second.writtenFiles).toEqual([])

    currentHtml = [
      '<html>',
      '  <head><title>URL Dedup Sample</title></head>',
      '  <body>',
      '    <article>',
      '      <h1>URL Dedup Sample</h1>',
      '      <p>Entity: GraphOps</p>',
      '      <p>Concept: stability</p>',
      '      <p>GraphOps keeps stability resilient.</p>',
      '    </article>',
      '  </body>',
      '</html>',
    ].join('\n')

    const third = await runIngestCommand({ knowledgeRoot, input: url })

    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function removeStoredPageSnapshots(knowledgeRoot: string, sourcePath: string) {
  const manifestPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json')
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as {
    entries: Record<string, { lastOutputManifest?: { pageSnapshots?: unknown[] } | null }>
  }

  const entry = manifest.entries[path.resolve(sourcePath)]
  if (!entry?.lastOutputManifest) {
    throw new Error(`Missing dedup manifest entry for ${sourcePath}`)
  }

  delete entry.lastOutputManifest.pageSnapshots
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function readJobs(knowledgeRoot: string): Promise<Record<string, { status: string }>> {
  const raw = await readFile(path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'), 'utf8')
  return (JSON.parse(raw) as { jobs: Record<string, { status: string }> }).jobs
}

async function readDedupManifest(knowledgeRoot: string): Promise<{
  entries: Record<string, { lastSuccessfulJobId: string | null; lastOutputManifest?: { pageFiles: string[]; indexEntries: string[] } | null }>
}> {
  const raw = await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')
  return JSON.parse(raw) as {
    entries: Record<string, { lastSuccessfulJobId: string | null; lastOutputManifest?: { pageFiles: string[]; indexEntries: string[] } | null }>
  }
}
