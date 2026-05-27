import { describe, expect, it } from 'vitest'
import { parseRepoSource } from '../../src/parsers/repo.js'

describe('minimal repo parser', () => {
  it('keeps repo parsing shallow and bounded with canonical artifact fields', async () => {
    const artifact = await parseRepoSource({
      sourceId: 'r1',
      repoPath: 'tests/fixtures/repos/minimal-repo',
      maxSampleFiles: 3,
      parsedAt: '2026-04-19T18:00:00.000Z',
    })

    expect(artifact).toMatchObject({
      id: 'r1',
      sourceKind: 'repo',
      sourceRef: 'tests/fixtures/repos/minimal-repo',
      title: 'minimal-repo',
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
      metadata: {
        parser: 'repo',
        path: 'tests/fixtures/repos/minimal-repo',
        repoName: 'minimal-repo',
        totalFiles: 10,
        readmeFiles: 3,
        capturedReadmeFiles: 2,
        omittedReadmeFiles: 1,
        docFiles: 3,
        capturedDocFiles: 2,
        omittedDocFiles: 1,
        sampleCandidateFiles: 4,
        sampledFiles: 3,
        omittedSampleFiles: 1,
      },
    })

    expect(artifact).not.toHaveProperty('kind')
    expect(artifact).not.toHaveProperty('body')

    expect(artifact.content).toContain('Repository: minimal-repo')
    expect(artifact.content).toContain('Scan mode: shallow snapshot')
    expect(artifact.content).toContain('Deep analysis: intentionally skipped')
    expect(artifact.content).toContain('README.md')
    expect(artifact.content).toContain('docs/api.md')
    expect(artifact.content).toContain('docs/overview.md')
    expect(artifact.content).toContain('src/a.ts')
    expect(artifact.content).toContain('src/b.ts')
    expect(artifact.content).toContain('src/example.ts')
    expect(artifact.content).toContain('[omitted: 1 additional README file skipped to preserve shallow repo boundary]')
    expect(artifact.content).toContain('[omitted: 1 additional docs file skipped to preserve shallow repo boundary]')
    expect(artifact.content).toContain('[omitted: 1 additional sample file skipped to preserve shallow repo boundary]')
    expect(artifact.content).not.toContain('packages/core/README.md')
    expect(artifact.content).not.toContain('docs/setup.md')
    expect(artifact.content).not.toContain('src/z.ts')
  })
})
