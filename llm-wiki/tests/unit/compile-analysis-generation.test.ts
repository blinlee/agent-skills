import { describe, expect, it } from 'vitest'
import type { NormalizedArtifact } from '../../src/types'
import { analyzeArtifact } from '../../src/compile/analysis'
import type { ArtifactAnalysis } from '../../src/compile/analysis'
import { generateKnowledgeChanges } from '../../src/compile/generation'

describe('compile pipeline', () => {
  it('parses singular structured markers without relying on heuristic fallback', async () => {
    const artifact: NormalizedArtifact = {
      id: 's1',
      sourceKind: 'md',
      sourceRef: '/tmp/runtime-notes.md',
      title: 'runtime notes',
      content: 'Entity: rust-analyzer\nConcept: compilation\n\nnotes about deterministic passes.',
      summary: 'runtime notes about rust-analyzer compilation.',
      tags: [],
      metadata: {
        sourceId: 's1',
        path: '/tmp/runtime-notes.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)

    expect(analysis.candidateEntities).toEqual([
      expect.objectContaining({
        slug: 'rust-analyzer',
        title: 'Rust Analyzer',
        source: 'marker',
        confidence: 0.94,
      }),
    ])
    expect(analysis.candidateConcepts).toEqual([
      expect.objectContaining({
        slug: 'compilation',
        title: 'Compilation',
        source: 'marker',
        confidence: 0.91,
      }),
    ])
  })

  it('keeps strong structured evidence as proposals without materializing semantic pages', async () => {
    const artifact: NormalizedArtifact = {
      id: 's2',
      sourceKind: 'md',
      sourceRef: '/tmp/compiler-notes.md',
      title: 'runtime notes',
      content: 'Entity: OpenClaw.\nConcept: compilation.\n\nOpenClaw keeps compilation deterministic.',
      summary: 'runtime notes about OpenClaw compilation.',
      tags: [],
      metadata: {
        sourceId: 's2',
        path: '/tmp/compiler-notes.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)
    const result = await generateKnowledgeChanges(analysis)

    expect(analysis.sourceSummary.length).toBeGreaterThan(0)
    expect(analysis.candidateEntities.map((candidate) => candidate.slug)).toContain('openclaw')
    expect(analysis.candidateConcepts.map((candidate) => candidate.slug)).toContain('compilation')
    expect(analysis.reviewTriggers).toEqual([])
    expect(analysis.relationHints).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromSlug: 'openclaw', toSlug: 'compilation', kind: 'relates-to' }),
    ]))

    expect(result.sourcePage.slug).toContain('runtime-notes')
    expect(result.entityPages).toEqual([])
    expect(result.conceptPages).toEqual([])
    expect(result.indexMutations.length).toBeGreaterThan(0)
    expect(result.logMutations.length).toBeGreaterThan(0)
    expect(result.taxonomyEffects.every((effect) => effect.action === 'propose-topic')).toBe(true)
    expect(result.taxonomyEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Compilation',
        source: expect.objectContaining({ slug: result.sourcePage.slug, title: result.sourcePage.title }),
      }),
    ]))
    expect(result.reviewEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactId: artifact.id,
        kind: 'semantic-candidate',
        reason: expect.stringContaining('Candidate entity "OpenClaw"'),
        candidate: expect.objectContaining({
          kind: 'entity',
          slug: 'openclaw',
          title: 'OpenClaw',
          source: 'marker',
          evidence: expect.arrayContaining(['Entity: OpenClaw.']),
        }),
      }),
      expect.objectContaining({
        artifactId: artifact.id,
        kind: 'semantic-candidate',
        reason: expect.stringContaining('Candidate concept "Compilation"'),
        candidate: expect.objectContaining({
          kind: 'concept',
          slug: 'compilation',
          title: 'Compilation',
          source: 'marker',
          evidence: expect.arrayContaining(['Concept: compilation.']),
        }),
      }),
    ]))
  })

  it('does not render unapproved relation hints as durable wiki links', async () => {
    const artifact: NormalizedArtifact = {
      id: 'relation-links',
      sourceKind: 'md',
      sourceRef: '/tmp/relation-links.md',
      title: 'Relation Links',
      content: 'Entity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.',
      summary: 'Relation links about OpenClaw compilation.',
      tags: [],
      metadata: {
        sourceId: 'relation-links',
        path: '/tmp/relation-links.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)
    const result = await generateKnowledgeChanges(analysis)

    expect(result.sourcePage.body).not.toContain('[[entities/openclaw|OpenClaw]]')
    expect(result.sourcePage.body).not.toContain('[[concepts/compilation|Compilation]]')
    expect(result.sourcePage.body).toContain('Semantic candidates are stored in review and taxonomy proposal files until approved.')
  })


  it('gates low-confidence heuristic classifications behind review instead of durable wiki pages', async () => {
    const artifact: NormalizedArtifact = {
      id: 's2-governance',
      sourceKind: 'md',
      sourceRef: '/tmp/compiler-notes.md',
      title: 'Compiler Notes',
      content: 'Entity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic. Rust Analyzer observes the flow.',
      summary: 'Compiler Notes about OpenClaw compilation and Rust Analyzer.',
      tags: [],
      metadata: {
        sourceId: 's2-governance',
        path: '/tmp/compiler-notes.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)
    const result = await generateKnowledgeChanges(analysis)

    expect(analysis.candidateEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'openclaw', source: 'marker', confidence: 0.94 }),
      expect.objectContaining({ slug: 'compiler-notes', source: 'heuristic', confidence: 0.58 }),
      expect.objectContaining({ slug: 'rust-analyzer', source: 'heuristic', confidence: 0.58 }),
    ]))
    expect(result.entityPages).toEqual([])
    expect(result.conceptPages).toEqual([])
    expect(result.reviewEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactId: artifact.id,
        kind: 'low-confidence',
        severity: 'low',
        reason: expect.stringMatching(/Rust Analyzer/),
        candidate: expect.objectContaining({
          kind: 'entity',
          slug: 'rust-analyzer',
          title: 'Rust Analyzer',
          source: 'heuristic',
        }),
      }),
    ]))
  })

  it('combines structured markers with same-class heuristics before dedupe and bounds', async () => {
    const artifact: NormalizedArtifact = {
      id: 's3',
      sourceKind: 'md',
      sourceRef: '/tmp/provisioning-overview.md',
      title: 'Provisioning Architecture',
      content: 'Entity: OpenClaw\nConcept: compilation\n\nRust Analyzer keeps provisioning and monitoring deterministic.',
      summary: 'Provisioning architecture for OpenClaw.',
      tags: [],
      metadata: {
        sourceId: 's3',
        path: '/tmp/provisioning-overview.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)

    expect(analysis.candidateEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'openclaw', source: 'marker' }),
      expect.objectContaining({ slug: 'rust-analyzer', source: 'heuristic' }),
    ]))
    expect(analysis.candidateConcepts).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'compilation', source: 'marker' }),
      expect.objectContaining({ slug: 'provisioning-architecture', source: 'heuristic' }),
    ]))
    expect(analysis.candidateEntities.length).toBeLessThanOrEqual(6)
    expect(analysis.candidateConcepts.length).toBeLessThanOrEqual(6)
  })

  it.each([
    { id: 'slug-nonascii', title: '编译笔记' },
    { id: 'slug-symbols', title: '🔥 !!! ###' },
  ])('falls back to artifact id when title slug collapses: $title', async ({ id, title }) => {
    const artifact: NormalizedArtifact = {
      id,
      sourceKind: 'md',
      sourceRef: `/tmp/${id}.md`,
      title,
      content: 'Entity: OpenClaw\nConcept: compilation\n\nDeterministic notes.',
      summary: `${title} summary.`,
      tags: [],
      metadata: {
        sourceId: id,
        path: `/tmp/${id}.md`,
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)
    const result = await generateKnowledgeChanges(analysis)

    expect(result.sourcePage.slug).toBe(id)
    expect(result.indexMutations).toContainEqual(expect.objectContaining({
      target: 'wiki/index.md',
      value: `- [[sources/${id}|${title}]]`,
    }))
    expect(result.logMutations).toContainEqual(expect.objectContaining({
      target: 'wiki/log.md',
      value: `${artifact.updatedAt}\tcompiled\t${artifact.id}\t${id}`,
    }))
  })

  it('suppresses repo heading noise while preserving meaningful prose entities', async () => {
    const artifact: NormalizedArtifact = {
      id: 'repo-noise-1',
      sourceKind: 'repo',
      sourceRef: '/tmp/minimal-repo',
      title: 'minimal-repo',
      content: [
        'Repository: minimal-repo',
        'Captured files:',
        '--- docs/api.md (docs) ---',
        '# API',
        '',
        'This document explains how OpenClaw coordinates ingestion.',
        'It also mentions Nested README examples that should stay generic.',
        '',
        '--- docs/overview.md (docs) ---',
        '# Overview',
        '',
        'Rust Analyzer keeps compilation deterministic.',
      ].join('\n'),
      summary: 'Shallow repo snapshot.',
      tags: [],
      metadata: {
        sourceId: 'repo-noise-1',
        path: '/tmp/minimal-repo',
        parser: 'repo',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)
    const entitySlugs = analysis.candidateEntities.map((candidate) => candidate.slug)

    expect(entitySlugs).toEqual(expect.arrayContaining(['openclaw', 'rust-analyzer']))
    expect(entitySlugs).not.toEqual(expect.arrayContaining([
      'api',
      'overview',
      'examples',
      'nested-readme',
      'this',
      'it',
    ]))
  })

  it('suppresses url title heuristics when explicit markers exist', async () => {
    const artifact: NormalizedArtifact = {
      id: 'url-1',
      sourceKind: 'url',
      sourceRef: 'https://example.com/url-sample',
      title: 'URL Sample',
      content: 'Entity: OpenClaw\nConcept: routing\n\nOpenClaw keeps routing predictable.',
      summary: 'URL sample about OpenClaw routing.',
      tags: [],
      metadata: {
        sourceId: 'url-1',
        path: 'https://example.com/url-sample',
        parser: 'url',
        url: 'https://example.com/url-sample',
      },
      createdAt: '2026-04-20T05:00:00.000Z',
      updatedAt: '2026-04-20T05:00:00.000Z',
    }

    const analysis = await analyzeArtifact(artifact)

    expect(analysis.candidateEntities).toEqual([
      expect.objectContaining({
        slug: 'openclaw',
        title: 'OpenClaw',
        source: 'marker',
        confidence: 0.94,
      }),
    ])
    expect(analysis.candidateConcepts).toEqual([
      expect.objectContaining({
        slug: 'routing',
        title: 'Routing',
        source: 'marker',
        confidence: 0.91,
      }),
    ])
    expect(analysis.reviewTriggers).toEqual([])
  })

  it('trusts canonical analysis review triggers when generating review effects', async () => {
    const artifact: NormalizedArtifact = {
      id: 's4',
      sourceKind: 'md',
      sourceRef: '/tmp/compiler-review.md',
      title: 'Compiler Review',
      content: 'Entity: OpenClaw\nConcept: compilation',
      summary: 'Compiler review notes.',
      tags: [],
      metadata: {
        sourceId: 's4',
        path: '/tmp/compiler-review.md',
        parser: 'markdown',
      },
      createdAt: '2026-04-19T18:00:00.000Z',
      updatedAt: '2026-04-19T18:00:00.000Z',
    }

    const analysis: ArtifactAnalysis = {
      artifact,
      artifactId: artifact.id,
      sourceSummary: 'Compiler Review: Entity and concept markers were extracted.',
      candidateEntities: [
        {
          slug: 'openclaw',
          title: 'OpenClaw',
          confidence: 0.94,
          source: 'marker',
          evidence: ['Entity: OpenClaw'],
        },
      ],
      candidateConcepts: [
        {
          slug: 'compilation',
          title: 'Compilation',
          confidence: 0.91,
          source: 'marker',
          evidence: ['Concept: compilation'],
        },
      ],
      topics: [
        {
          slug: 'compilation',
          title: 'Compilation',
          confidence: 0.91,
          rationale: 'Derived from concept candidate "Compilation".',
          matchedFrom: ['concept'],
        },
      ],
      relationHints: [],
      reviewTriggers: [
        {
          kind: 'low-confidence',
          severity: 'low',
          reason: 'Canonical analysis requested manual review.',
        },
      ],
      confidence: 0.92,
    }

    const result = await generateKnowledgeChanges(analysis)

    expect(result.reviewEffects).toEqual(expect.arrayContaining([
      {
        artifactId: artifact.id,
        kind: 'low-confidence',
        severity: 'low',
        reason: 'Canonical analysis requested manual review.',
      },
      expect.objectContaining({
        artifactId: artifact.id,
        kind: 'semantic-candidate',
        reason: expect.stringContaining('Candidate entity "OpenClaw"'),
      }),
      expect.objectContaining({
        artifactId: artifact.id,
        kind: 'semantic-candidate',
        reason: expect.stringContaining('Candidate concept "Compilation"'),
      }),
    ]))
  })
})
