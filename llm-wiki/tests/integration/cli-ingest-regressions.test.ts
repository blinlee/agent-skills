import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runLintCommand, runQueryCommand } from '../../src/cli.js'
import { runIngestCommandWithCuration, testConcept, testEntity, testSynthesis, writeTestCurationPlan } from '../helpers/curation.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `no-embedding-config-${Date.now()}.json`))
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

    await runIngestCommandWithCuration({ knowledgeRoot, input: sourceA })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: sourceB })

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
      runIngestCommandWithCuration({ knowledgeRoot, input: sourceA }),
      runIngestCommandWithCuration({ knowledgeRoot, input: sourceB }),
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

  it('does not overwrite another source synthesis page when curated synthesis slugs collide', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-synthesis-collision-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourceAPath = path.join(inputRoot, 'alpha-synthesis.md')
    const sourceBPath = path.join(inputRoot, 'beta-synthesis.md')
    await writeFile(
      sourceAPath,
      '# Alpha Synthesis\n\nAlpha source says synthesis ownership must preserve alpha evidence.\n',
      'utf8',
    )
    await writeFile(
      sourceBPath,
      '# Beta Synthesis\n\nBeta source says synthesis ownership must preserve beta evidence.\n',
      'utf8',
    )

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceAPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceAPath,
        baseDir: knowledgeRoot,
        syntheses: [testSynthesis({
          title: 'Shared Synthesis',
          slug: 'shared-synthesis',
          quote: 'Alpha source says synthesis ownership must preserve alpha evidence.',
        })],
      }),
    })
    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceBPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceBPath,
        baseDir: knowledgeRoot,
        syntheses: [testSynthesis({
          title: 'Shared Synthesis',
          slug: 'shared-synthesis',
          quote: 'Beta source says synthesis ownership must preserve beta evidence.',
        })],
      }),
    })

    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis.md'), 'utf8'))
      .resolves.toContain('alpha evidence')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis-beta-synthesis.md'), 'utf8'))
      .resolves.toContain('beta evidence')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'beta-synthesis.md'), 'utf8'))
      .resolves.toContain('[[syntheses/shared-synthesis-beta-synthesis|Shared Synthesis]]')
  })

  it('does not overwrite source-owned semantic pages after manual edits', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-manual-semantic-edit-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'alpha-manual.md')
    await writeFile(
      sourcePath,
      '# Alpha Manual\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic. Shared synthesis evidence stays grounded.\n',
      'utf8',
    )
    const curation = async () => writeTestCurationPlan({
      sourcePath,
      baseDir: knowledgeRoot,
      entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
      concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      syntheses: [testSynthesis({
        title: 'Shared Synthesis',
        slug: 'shared-synthesis',
        quote: 'Shared synthesis evidence stays grounded.',
      })],
    })

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await curation(),
    })
    expect(first.status).toBe('completed')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), `${await readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8')}\nManual entity edit must stay.\n`, 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), `${await readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8')}\nManual concept edit must stay.\n`, 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis.md'), `${await readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis.md'), 'utf8')}\nManual synthesis edit must stay.\n`, 'utf8')
    await writeFile(
      sourcePath,
      '# Alpha Manual\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic. Shared synthesis evidence stays grounded.\n\nChanged source body.\n',
      'utf8',
    )

    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await curation(),
    })

    expect(second.status).toBe('completed')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8'))
      .resolves.toContain('Manual entity edit must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8'))
      .resolves.toContain('Manual concept edit must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis.md'), 'utf8'))
      .resolves.toContain('Manual synthesis edit must stay.')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw-alpha-manual.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation-alpha-manual.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'shared-synthesis-alpha-manual.md'))).resolves.toBeUndefined()
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-manual.md'), 'utf8'))
      .resolves.toContain('[[syntheses/shared-synthesis-alpha-manual|Shared Synthesis]]')
  })

  it('materializes ordinary semantics while removing source-owned stale outputs on changed-source recompiles', async () => {
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

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceBPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceBPath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Reliability', quote: 'Concept: reliability' })],
      }),
    })
    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceAPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceAPath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Reliability', quote: 'Concept: reliability' })],
      }),
    })
    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'alpha-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'beta-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'reliability-concept-overview.md'), 'utf8'))
      .resolves.toContain('这是入库流程自动维护的概念主题页')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'openclaw-entity-overview.md'), 'utf8'))
      .resolves.toContain('这是入库流程自动维护的实体主题页')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'), 'utf8'))
      .resolves.toContain('[[syntheses/reliability-concept-overview|Reliability 主题综述]]')

    await writeFile(
      sourceAPath,
      '# alpha digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability high.\n',
      'utf8',
    )

    const recompiled = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceAPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceAPath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'GraphOps', quote: 'Entity: GraphOps' })],
        concepts: [testConcept({ title: 'Stability', quote: 'Concept: stability' })],
      }),
    })
    expect(recompiled.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(recompiled.status).toBe('completed')

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'readings', 'alpha-notes.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-notes-synthesis.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'alpha-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'alpha-digest-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'beta-notes-synthesis.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'reliability-concept-overview.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'syntheses', 'openclaw-entity-overview.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'beta-notes.md'), 'utf8'))
      .resolves.toContain('[[syntheses/wiki-topic-overview|Wiki 资料总览]]')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'beta-notes.md'), 'utf8'))
      .resolves.not.toContain('[[syntheses/reliability-concept-overview|Reliability 主题综述]]')

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).toContain('[[entities/openclaw|OpenClaw]]')
    expect(indexContent).toContain('[[concepts/reliability|Reliability]]')
    expect(indexContent).toContain('[[entities/graphops|GraphOps]]')
    expect(indexContent).toContain('[[concepts/stability|Stability]]')
    expect(indexContent).toContain('[[readings/alpha-digest|alpha digest - 完整原文]]')
    expect(indexContent).toContain('[[sources/alpha-digest|alpha digest]]')
    expect(indexContent).toContain('[[sources/beta-notes|beta notes]]')
    expect(indexContent).not.toContain('[[readings/alpha-notes|alpha notes - 完整原文]]')
    expect(indexContent).not.toContain('[[sources/alpha-notes|alpha notes]]')
    expect(indexContent).not.toContain('[[syntheses/alpha-digest-synthesis|GraphOps × Stability]]')
    expect(indexContent).not.toContain('[[syntheses/beta-notes-synthesis|OpenClaw × Reliability]]')
    expect(indexContent).not.toContain('[[syntheses/alpha-notes-synthesis|OpenClaw × Reliability]]')
    expect(indexContent).not.toContain('[[syntheses/reliability-concept-overview|Reliability 主题综述]]')
    expect(indexContent).not.toContain('[[syntheses/openclaw-entity-overview|OpenClaw 主题综述]]')

    const dedupManifest = await readDedupManifest(knowledgeRoot)
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest).toMatchObject({
      pageFiles: expect.arrayContaining([
        'wiki/sources/alpha-digest.md',
        'wiki/readings/alpha-digest.md',
        'wiki/entities/graphops.md',
        'wiki/concepts/stability.md',
      ]),
      indexEntries: expect.arrayContaining([
        '- [[sources/alpha-digest|alpha digest]]',
        '- [[readings/alpha-digest|alpha digest - 完整原文]]',
        '- [[entities/graphops|GraphOps]]',
        '- [[concepts/stability|Stability]]',
      ]),
    })
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/readings/alpha-notes.md')
    expect(dedupManifest.entries[path.resolve(sourceAPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/syntheses/alpha-digest-synthesis.md')
    expect(dedupManifest.entries[path.resolve(sourceBPath)]?.lastOutputManifest?.pageFiles).toEqual(expect.arrayContaining([
      'wiki/sources/beta-notes.md',
      'wiki/readings/beta-notes.md',
      'wiki/entities/openclaw.md',
      'wiki/concepts/reliability.md',
    ]))
    expect(dedupManifest.entries[path.resolve(sourceBPath)]?.lastOutputManifest?.pageFiles).not.toContain('wiki/syntheses/beta-notes-synthesis.md')
  })

  it('does not overwrite manual synthesis pages when generated overviews collide', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    await mkdir(path.join(knowledgeRoot, 'wiki', 'syntheses'), { recursive: true })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'syntheses', 'wiki-topic-overview.md'),
      '# Manual Wiki Topic Overview\n\nHuman-approved synthesis must stay.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'syntheses', 'openclaw-entity-overview.md'),
      '# Manual OpenClaw Overview\n\nHuman-approved entity synthesis must stay.\n',
      'utf8',
    )

    const sourceAPath = path.join(inputRoot, 'alpha-notes.md')
    const sourceBPath = path.join(inputRoot, 'beta-notes.md')
    await writeFile(
      sourceAPath,
      '# alpha notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw keeps reliability visible.\n',
      'utf8',
    )
    await writeFile(
      sourceBPath,
      '# beta notes\n\nEntity: OpenClaw\nConcept: reliability\n\nOpenClaw documents reliability work.\n',
      'utf8',
    )

    expect((await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceAPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceAPath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Reliability', quote: 'Concept: reliability' })],
      }),
    })).status).toBe('completed')
    expect((await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourceBPath,
      curationPath: await writeTestCurationPlan({
        sourcePath: sourceBPath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Reliability', quote: 'Concept: reliability' })],
      }),
    })).status).toBe('completed')

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'wiki-topic-overview.md'), 'utf8'))
      .resolves.toContain('Human-approved synthesis must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'openclaw-entity-overview.md'), 'utf8'))
      .resolves.toContain('Human-approved entity synthesis must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'wiki-topic-overview-generated.md'), 'utf8'))
      .resolves.toContain('generatedBy: "llm-wiki-semantic-overview"')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'syntheses', 'openclaw-entity-overview-generated.md'), 'utf8'))
      .resolves.toContain('generatedBy: "llm-wiki-semantic-overview"')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha-notes.md'), 'utf8'))
      .resolves.toContain('[[syntheses/wiki-topic-overview-generated|Wiki 资料总览]]')
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

    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: repoRoot })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: repoRoot })

    expect(first.dedupDecision).toEqual({ action: 'compile', reason: 'first-seen' })
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(second.writtenFiles).toEqual([])

    await writeFile(
      path.join(repoRoot, 'docs', 'overview.md'),
      'The repo now documents GraphOps stability.\n\nEntity: GraphOps\nConcept: stability\n',
      'utf8',
    )

    const third = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: repoRoot,
      curationPath: await writeTestCurationPlan({
        sourcePath: repoRoot,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'GraphOps', quote: 'Entity: GraphOps' })],
        concepts: [testConcept({ title: 'Stability', quote: 'Concept: stability' })],
      }),
    })

    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).resolves.toBeUndefined()
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
    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: url })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: url })

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

    const third = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: url,
      curationPath: await writeTestCurationPlan({
        sourcePath: url,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'GraphOps', quote: 'Entity: GraphOps' })],
        concepts: [testConcept({ title: 'Stability', quote: 'Concept: stability' })],
      }),
    })

    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).resolves.toBeUndefined()
  })
})

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
