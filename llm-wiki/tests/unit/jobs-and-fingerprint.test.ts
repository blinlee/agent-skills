import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDedupStore } from '../../src/intake/dedup-store.js'
import { hashContent, hashFileLike, hashSourceMetadata } from '../../src/intake/fingerprint.js'
import { classifySource, isLikelyRepoSource } from '../../src/intake/source-discovery.js'
import { createJobStore } from '../../src/jobs/job-store.js'

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('job store and fingerprinting', () => {
  it('produces stable hashes for identical content', async () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(await hashFileLike(Buffer.from('abc'))).toBe(hashContent('abc'))
  })

  it('hashes metadata fingerprints deterministically', () => {
    expect(hashSourceMetadata({ kind: 'url', identity: 'https://example.com', etag: '123' })).toBe(
      hashSourceMetadata({ etag: '123', identity: 'https://example.com', kind: 'url' }),
    )
  })

  it('persists and reloads job state', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-jobs-'))
    tempPaths.push(tempRoot)

    const store = createJobStore(path.join(tempRoot, 'system', 'jobs', 'jobs.json'))
    await store.save({ id: 'job-1', status: 'queued', sourceKind: 'md' })
    await store.updateStatus('job-1', 'running', { step: 'compile' })

    const saved = await store.get('job-1')
    expect(saved?.status).toBe('running')
    expect(saved?.details).toEqual({ step: 'compile' })

    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe('job-1')
  })

  it('serializes concurrent job-store writes without losing entries', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-jobs-'))
    tempPaths.push(tempRoot)

    const store = createJobStore(path.join(tempRoot, 'system', 'jobs', 'jobs.json'))

    await Promise.all([
      store.save({ id: 'job-1', status: 'queued', sourceKind: 'md' }),
      store.save({ id: 'job-2', status: 'queued', sourceKind: 'txt' }),
    ])

    const listed = await store.list()
    expect(listed.map((job) => job.id).sort()).toEqual(['job-1', 'job-2'])
  })

  it('stores dedup manifests and decides whether to compile', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-'))
    tempPaths.push(tempRoot)

    const store = createDedupStore(path.join(tempRoot, 'system', 'dedup', 'manifest.json'))

    expect(await store.shouldCompile({ identity: 'notes.md', sourceKind: 'md', fingerprint: 'fp-1' })).toEqual({
      action: 'compile',
      reason: 'first-seen',
    })

    await store.recordSuccess({
      identity: 'notes.md',
      sourceKind: 'md',
      fingerprint: 'fp-1',
      jobId: 'job-1',
      compiledAt: '2026-04-19T17:30:00.000Z',
    })

    expect(await store.shouldCompile({ identity: 'notes.md', sourceKind: 'md', fingerprint: 'fp-1' })).toEqual({
      action: 'skip',
      reason: 'unchanged',
    })

    expect(await store.shouldCompile({ identity: 'notes.md', sourceKind: 'md', fingerprint: 'fp-2' })).toEqual({
      action: 'recompile',
      reason: 'changed',
    })

    const persisted = JSON.parse(await readFile(path.join(tempRoot, 'system', 'dedup', 'manifest.json'), 'utf8'))
    expect(persisted.entries['notes.md'].lastSuccessfulJobId).toBe('job-1')
  })

  it('applies unchanged-skip semantics to repo and url entries too', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-'))
    tempPaths.push(tempRoot)

    const store = createDedupStore(path.join(tempRoot, 'system', 'dedup', 'manifest.json'))
    const cases = [
      { identity: '/tmp/example-repo', sourceKind: 'repo' as const },
      { identity: 'https://example.com/article', sourceKind: 'url' as const },
    ]

    for (const testCase of cases) {
      expect(await store.shouldCompile({ ...testCase, fingerprint: 'fp-1' })).toEqual({
        action: 'compile',
        reason: 'first-seen',
      })

      await store.recordSuccess({
        ...testCase,
        fingerprint: 'fp-1',
        jobId: `${testCase.sourceKind}-job-1`,
      })

      expect(await store.shouldCompile({ ...testCase, fingerprint: 'fp-1' })).toEqual({
        action: 'skip',
        reason: 'unchanged',
      })

      expect(await store.shouldCompile({ ...testCase, fingerprint: 'fp-2' })).toEqual({
        action: 'recompile',
        reason: 'changed',
      })
    }
  })

  it('serializes concurrent dedup writes without losing manifest entries', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-'))
    tempPaths.push(tempRoot)

    const store = createDedupStore(path.join(tempRoot, 'system', 'dedup', 'manifest.json'))

    await Promise.all([
      store.recordSuccess({ identity: 'notes.md', sourceKind: 'md', fingerprint: 'fp-1', jobId: 'job-1' }),
      store.recordSuccess({ identity: 'notes.txt', sourceKind: 'txt', fingerprint: 'fp-2', jobId: 'job-2' }),
    ])

    const persisted = JSON.parse(await readFile(path.join(tempRoot, 'system', 'dedup', 'manifest.json'), 'utf8'))
    expect(Object.keys(persisted.entries).sort()).toEqual(['notes.md', 'notes.txt'])
  })

  it('classifies supported source kinds', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-repo-'))
    tempPaths.push(tempRoot)

    expect(classifySource('README.md')).toBe('md')
    expect(classifySource('/tmp/notes.txt')).toBe('txt')
    expect(classifySource('https://example.com/article')).toBe('url')
    expect(classifySource('https://example.com/readme.md')).toBe('url')
    expect(classifySource('git@github.com:lobehub/lobechat.git')).toBe('repo')
    expect(classifySource('openai/openclaw')).toBe('repo')
    expect(classifySource(tempRoot)).toBe('repo')
    expect(classifySource('opaque-input')).toBe('unknown')
    expect(isLikelyRepoSource('https://github.com/openai/openclaw')).toBe(true)
  })
})
