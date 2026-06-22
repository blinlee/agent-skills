import type { ChunkIndexEntryV2 } from './types.js'

export type RetrievalGraphLink = {
  from: string
  to: string | null
  status: 'resolved' | 'missing' | 'ambiguous'
}

export type RetrievalGraphIndex = {
  links: RetrievalGraphLink[]
  backlinks: Record<string, string[]>
}

export type GraphBoost = {
  score: number
  reasons: string[]
}

const DIRECT_LINK_BOOST = 0.12
const BACKLINK_BOOST = 0.08
const SECOND_HOP_LINK_BOOST = 0.04
const SECOND_HOP_BACKLINK_BOOST = 0.025
const MAX_GRAPH_BOOST = 0.22

export function scoreGraphBoosts(input: {
  chunks: ChunkIndexEntryV2[]
  graph: RetrievalGraphIndex | null
  lexicalScores: Map<string, { score: number; terms: string[] }>
}): Map<string, GraphBoost> {
  if (!input.graph) {
    return new Map()
  }

  const seedTargets = new Set<string>()
  for (const [chunkId, score] of input.lexicalScores.entries()) {
    if (score.score <= 0) {
      continue
    }
    const chunk = input.chunks.find((candidate) => candidate.chunkId === chunkId)
    if (chunk) {
      seedTargets.add(chunk.pageTarget)
    }
  }

  if (seedTargets.size === 0) {
    return new Map()
  }

  const boostsByPage = new Map<string, GraphBoost>()
  const firstHopTargets = new Set<string>()
  for (const seed of seedTargets) {
    for (const target of outgoingResolvedTargets(seed, input.graph)) {
      firstHopTargets.add(target)
      addPageBoost(boostsByPage, target, DIRECT_LINK_BOOST, `graph:outlink:${seed}`)
    }
    for (const owner of input.graph.backlinks[seed] ?? []) {
      firstHopTargets.add(owner)
      addPageBoost(boostsByPage, owner, BACKLINK_BOOST, `graph:backlink:${seed}`)
    }
  }

  for (const firstHop of firstHopTargets) {
    if (seedTargets.has(firstHop)) continue
    for (const target of outgoingResolvedTargets(firstHop, input.graph)) {
      if (seedTargets.has(target)) continue
      addPageBoost(boostsByPage, target, SECOND_HOP_LINK_BOOST, `graph:second-hop-outlink:${firstHop}`)
    }
    for (const owner of input.graph.backlinks[firstHop] ?? []) {
      if (seedTargets.has(owner)) continue
      addPageBoost(boostsByPage, owner, SECOND_HOP_BACKLINK_BOOST, `graph:second-hop-backlink:${firstHop}`)
    }
  }

  const result = new Map<string, GraphBoost>()
  for (const chunk of input.chunks) {
    const boost = boostsByPage.get(chunk.pageTarget)
    if (!boost || seedTargets.has(chunk.pageTarget)) {
      continue
    }
    result.set(chunk.chunkId, {
      score: Number(Math.min(boost.score, MAX_GRAPH_BOOST).toFixed(6)),
      reasons: [...new Set(boost.reasons)].sort(),
    })
  }
  return result
}

function outgoingResolvedTargets(pageTarget: string, graph: RetrievalGraphIndex): string[] {
  return graph.links
    .filter((link) => link.from === pageTarget && link.status === 'resolved' && link.to)
    .map((link) => link.to!)
}

function addPageBoost(boosts: Map<string, GraphBoost>, pageTarget: string, score: number, reason: string): void {
  const current = boosts.get(pageTarget) ?? { score: 0, reasons: [] }
  current.score += score
  current.reasons.push(reason)
  boosts.set(pageTarget, current)
}
