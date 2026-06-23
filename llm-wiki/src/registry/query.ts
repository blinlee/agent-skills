import { createSensitiveRedactor } from '../query/query.js'
import { runRegistryHybridRetrieval, type QueryRegistryResult } from '../retrieval/registry.js'
import { appendJsonLine } from './helpers.js'
import { resolveRegistryPaths } from './paths.js'
import { rankWikis } from './ranking.js'
import type { QueryRegistryInput } from './registry.js'
import { readRegistryState, runRegistryInit } from './state.js'

export async function runQueryRegistry(input: QueryRegistryInput): Promise<QueryRegistryResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  if (state.wikis.length === 0) {
    throw new Error(`Cannot query registry: no wikis are registered in ${paths.registryFile}`)
  }

  const redactor = createSensitiveRedactor(input.question)
  const displayQuestion = redactor(input.question)
  const rankedWikis = rankWikis(input.question, state.wikis)
  const profilesById = new Map(state.wikis.map((wiki) => [wiki.id, wiki]))
  const selected = rankedWikis.map((candidate) => {
    const profile = profilesById.get(candidate.wikiId)
    return {
      ...candidate,
      scopeCore: profile?.scopeCore ?? [],
      scopeAdjacent: profile?.scopeAdjacent ?? [],
      scope: profile?.scope ?? [],
      outOfScope: profile?.outOfScope ?? [],
      aliases: profile?.aliases ?? [],
    }
  })

  const retrievalResult = await runRegistryHybridRetrieval({
    question: input.question,
    selectedWikis: selected,
    readingMode: input.readingMode,
    citationBudget: input.citationBudget,
    maxCitationsPerWiki: input.maxCitationsPerWiki,
    maxConcurrentWikis: input.maxConcurrentWikis,
  })
  await appendJsonLine(paths.queryLog, {
    question: displayQuestion,
    selectedWikis: retrievalResult.selectedWikis.map((wiki) => ({ wikiId: wiki.wikiId, score: wiki.score, chunkScore: wiki.chunkScore })),
    resultCount: retrievalResult.results.filter((entry) => entry.result).length,
    createdAt: new Date().toISOString(),
  })

  return {
    question: displayQuestion,
    ...retrievalResult,
  }
}
