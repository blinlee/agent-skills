import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadKeyInfoIndex,
  runKeyInfoExtraction,
  supplementalKeyInfoTextsByChunkId,
  type KeyInfoGenerator,
} from '../../src/retrieval/key-info.js'
import type { ParsedArtifact } from '../../src/parsers/base.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('key info extraction and indexing', () => {
  it('skips extraction when no provider is configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-key-info-'))
    tempRoots.push(knowledgeRoot)

    const result = await runKeyInfoExtraction({
      knowledgeRoot,
      artifact: artifact(),
      pageTarget: 'sources/compiler-notes',
      pageTitle: 'Compiler Notes',
      sourceIdentity: '/tmp/compiler.md',
      sourceKind: 'md',
      config: null,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'key_info extraction provider not configured',
    }))
  })

  it('writes normalized key info records and only exposes chunk-scoped supplemental lexical text', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-key-info-'))
    tempRoots.push(knowledgeRoot)
    const generator: KeyInfoGenerator = {
      async extract() {
        return {
          summary: 'Compiler Notes keeps compilation deterministic.',
          keyClaims: ['Compilation is deterministic across the pipeline.'],
          methodology: ['Use stable source notes.'],
          evidence: ['The source states deterministic compilation.'],
          limitations: ['Fixture only.'],
          relations: ['OpenClaw: source entity.'],
          openQuestions: [],
        }
      },
    }

    const result = await runKeyInfoExtraction({
      knowledgeRoot,
      artifact: artifact(),
      pageTarget: 'sources/compiler-notes',
      pageTitle: 'Compiler Notes',
      sourceIdentity: '/tmp/compiler.md',
      sourceKind: 'md',
      config: {
        endpoint: 'http://127.0.0.1:1/key-info',
        model: 'fixture-model',
        timeoutMs: 1000,
        maxInputChars: 12000,
        language: '中文',
        promptTemplate: '{title}\n{inputText}',
      },
      generator,
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(result.status).toBe('extracted')
    const index = await loadKeyInfoIndex(knowledgeRoot)
    expect(index.records[0]).toEqual(expect.objectContaining({
      pageTarget: 'sources/compiler-notes',
      pageTitle: 'Compiler Notes',
      model: 'fixture-model',
      summary: 'Compiler Notes keeps compilation deterministic.',
      keyClaims: ['Compilation is deterministic across the pipeline.'],
    }))

    const supplemental = supplementalKeyInfoTextsByChunkId({
      records: index.records,
      chunks: [{ chunkId: 'chunk-1', pageTarget: 'sources/compiler-notes' }],
    })
    expect(supplemental.get('chunk-1')).toBeUndefined()

    const chunkScopedSupplemental = supplementalKeyInfoTextsByChunkId({
      records: [{ ...index.records[0]!, chunkId: 'chunk-1' }],
      chunks: [{ chunkId: 'chunk-1', pageTarget: 'sources/compiler-notes' }],
    })
    expect(chunkScopedSupplemental.get('chunk-1')).toContain('Fixture only.')
  })
})

function artifact(): ParsedArtifact {
  const now = new Date().toISOString()
  return {
    id: 'artifact-1',
    sourceKind: 'md',
    sourceRef: '/tmp/compiler.md',
    title: 'Compiler Notes',
    content: '# Compiler Notes\n\nCompilation is deterministic.',
    summary: '',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
}
