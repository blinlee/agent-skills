import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand } from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `no-embedding-config-${Date.now()}.json`))
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('url ingest quality', () => {
  it('preserves explicit entity/concept markers from html and suppresses wrapper noise', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-url-quality-'))
    tempRoots.push(knowledgeRoot)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => [
          '<html>',
          '  <head><title>URL Sample</title></head>',
          '  <body>',
          '    <article>',
          '      <h1>URL Sample</h1>',
          '      <p>Entity: OpenClaw</p>',
          '      <p>Concept: routing</p>',
          '      <p>OpenClaw keeps routing predictable for this sample.</p>',
          '    </article>',
          '  </body>',
          '</html>',
        ].join('\n'),
      } satisfies Partial<Response> as Response)),
    )

    const result = await runIngestCommand({
      knowledgeRoot,
      input: 'https://example.com/url-sample',
    })

    const entityFiles = await readdir(path.join(knowledgeRoot, 'wiki', 'entities'))
    const conceptFiles = await readdir(path.join(knowledgeRoot, 'wiki', 'concepts'))

    expect(result.status).toBe('needs_review')
    expect(result.taxonomyFiles.length).toBeGreaterThan(0)
    expect(entityFiles).toEqual([])
    expect(conceptFiles).toEqual([])
    expect(entityFiles).not.toEqual(expect.arrayContaining(['url-sample.md', 'url-sample-url-sample.md', 'openclaw-concept.md']))
  })
})
