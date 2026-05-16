import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { defaultKnowledgeLayout, ensureKnowledgeRootLayout, resolveKnowledgePaths } from '../../src/paths'
import { SOURCE_KINDS } from '../../src/types'

describe('resolveKnowledgePaths', () => {
  it('returns all MVP directories for a knowledge root', () => {
    const paths = resolveKnowledgePaths('/tmp/llm-wiki')
    expect(paths.rawInbox).toBe('/tmp/llm-wiki/raw/inbox')
    expect(paths.reviewQueue).toBe('/tmp/llm-wiki/review/queue')
    expect(paths.topicRegistry).toBe('/tmp/llm-wiki/taxonomy/topic-registry.json')
  })

  it('exposes the default layout contract', () => {
    expect(defaultKnowledgeLayout).toContain('raw/inbox')
    expect(defaultKnowledgeLayout).toContain('raw/staged')
    expect(defaultKnowledgeLayout).toContain('raw/archive')
    expect(defaultKnowledgeLayout).toContain('raw/rejected')
    expect(defaultKnowledgeLayout).toContain('raw/objects')
    expect(defaultKnowledgeLayout).toContain('review/merge-candidates')
    expect(defaultKnowledgeLayout).toContain('graph')
    expect(defaultKnowledgeLayout).toContain('taxonomy/disambiguation')
    expect(defaultKnowledgeLayout).toContain('wiki/sources')
    expect(defaultKnowledgeLayout).toContain('system/jobs')
    expect(defaultKnowledgeLayout).toContain('system/dedup')
  })
})

describe('SourceKind', () => {
  it('matches the near-term MVP intake boundary', () => {
    expect(SOURCE_KINDS).toEqual(['md', 'txt', 'url', 'repo'])
  })
})

const ORIGINAL_ENV = { ...process.env }

describe('loadConfig', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.LLM_WIKI_KNOWLEDGE_ROOT
    delete process.env.LLM_WIKI_CACHE_DIR
    delete process.env.LLM_WIKI_JOB_STORE_PATH
    delete process.env.LLM_WIKI_URL_FETCH_TIMEOUT_MS
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns task defaults rooted in the current working directory', () => {
    const config = loadConfig()

    expect(config.knowledgeRoot).toBe(path.resolve(process.cwd(), 'knowledge'))
    expect(config.cacheDirectory).toBe(path.resolve(process.cwd(), '.cache', 'llm-wiki'))
    expect(config.jobStorePath).toBe(path.join(config.knowledgeRoot, 'system', 'jobs', 'jobs.json'))
    expect(config.repoSamplingLimits).toEqual({
      maxFiles: 200,
      maxBytes: 5 * 1024 * 1024,
    })
    expect(config.urlFetchTimeoutMs).toBe(15_000)
  })

  it('reads outward-facing config values from environment variables', () => {
    process.env.LLM_WIKI_KNOWLEDGE_ROOT = '/tmp/env-root'
    process.env.LLM_WIKI_CACHE_DIR = '/tmp/env-cache'
    process.env.LLM_WIKI_JOB_STORE_PATH = '/tmp/env-root/system/jobs/env-jobs.json'
    process.env.LLM_WIKI_URL_FETCH_TIMEOUT_MS = '2500'

    const config = loadConfig()

    expect(config.knowledgeRoot).toBe('/tmp/env-root')
    expect(config.cacheDirectory).toBe('/tmp/env-cache')
    expect(config.jobStorePath).toBe('/tmp/env-root/system/jobs/env-jobs.json')
    expect(config.urlFetchTimeoutMs).toBe(2_500)
    expect(config.repoSamplingLimits).toEqual({
      maxFiles: 200,
      maxBytes: 5 * 1024 * 1024,
    })
  })

  it('prefers explicit overrides over environment variables', () => {
    process.env.LLM_WIKI_KNOWLEDGE_ROOT = '/tmp/env-root'
    process.env.LLM_WIKI_CACHE_DIR = '/tmp/env-cache'
    process.env.LLM_WIKI_JOB_STORE_PATH = '/tmp/env-root/system/jobs/env-jobs.json'
    process.env.LLM_WIKI_URL_FETCH_TIMEOUT_MS = '2500'

    const config = loadConfig({
      knowledgeRoot: '/tmp/custom-root',
      cacheDirectory: '/tmp/custom-cache',
      jobStorePath: '/tmp/custom-root/system/jobs/store.json',
      repoSamplingLimits: {
        maxFiles: 20,
        maxBytes: 1_024,
      },
      urlFetchTimeoutMs: 2_000,
    })

    expect(config).toEqual({
      knowledgeRoot: '/tmp/custom-root',
      cacheDirectory: '/tmp/custom-cache',
      jobStorePath: '/tmp/custom-root/system/jobs/store.json',
      repoSamplingLimits: {
        maxFiles: 20,
        maxBytes: 1_024,
      },
      urlFetchTimeoutMs: 2_000,
    })
  })
})

describe('ensureKnowledgeRootLayout', () => {
  const tempRoots: string[] = []

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
  })

  it('creates the key MVP directories and bootstrap files for a knowledge root', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-'))
    tempRoots.push(tempRoot)

    const paths = await ensureKnowledgeRootLayout(tempRoot)

    expect((await stat(paths.rawInbox)).isDirectory()).toBe(true)
    expect((await stat(paths.reviewQueue)).isDirectory()).toBe(true)
    expect((await stat(paths.wikiSources)).isDirectory()).toBe(true)
    expect((await stat(paths.jobDirectory)).isDirectory()).toBe(true)
    expect((await stat(paths.dedupDirectory)).isDirectory()).toBe(true)
    expect((await stat(path.join(tempRoot, 'raw', 'staged'))).isDirectory()).toBe(true)
    expect((await stat(path.join(tempRoot, 'review', 'merge-candidates'))).isDirectory()).toBe(true)
    expect((await stat(path.join(tempRoot, 'graph'))).isDirectory()).toBe(true)

    await expect(readFile(path.join(tempRoot, 'wiki', 'index.md'), 'utf8')).resolves.toContain('# Wiki Index')
    await expect(readFile(path.join(tempRoot, 'wiki', 'log.md'), 'utf8')).resolves.toContain('# Wiki Log')
    await expect(readFile(path.join(tempRoot, 'system', 'jobs', 'jobs.json'), 'utf8')).resolves.toContain('"jobs"')
    await expect(readFile(path.join(tempRoot, 'system', 'dedup', 'manifest.json'), 'utf8')).resolves.toContain('"entries"')
    await expect(readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8')).resolves.toContain('"topics"')
    await expect(readFile(path.join(tempRoot, 'taxonomy', 'aliases.json'), 'utf8')).resolves.toContain('\"aliases\"')
    await expect(readFile(path.join(tempRoot, 'taxonomy', 'category-graph.json'), 'utf8')).resolves.toContain('\"edges\"')
    await expect(readFile(path.join(tempRoot, 'taxonomy', 'redirects.json'), 'utf8')).resolves.toContain('\"redirects\"')
  })
})
