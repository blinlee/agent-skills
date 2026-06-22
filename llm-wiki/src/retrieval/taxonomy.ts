import type { ChunkIndexEntryV2 } from './types.js'
import type { GraphBoost } from './graph.js'

export type RetrievalTaxonomyIndex = {
  topics: TaxonomyTopic[]
  topicNodes: TaxonomyTopicNode[]
  aliases: Record<string, string>
  redirects: Record<string, string>
  categoryEdges: TaxonomyCategoryEdge[]
}

export type TaxonomyTopic = {
  slug: string
  name: string
}

export type TaxonomyTopicNode = {
  slug: string
  name: string
  aliases: string[]
  redirectsFrom: string[]
  relatedSlugs: string[]
  chunkIds: string[]
  pageTargets: string[]
  sourceRefs: string[]
}

export type TaxonomyCategoryEdge = {
  from: string
  to: string
  type?: string
  status?: string
}

const TAXONOMY_ALIAS_BOOST = 0.16
const TAXONOMY_REDIRECT_BOOST = 0.16
const TAXONOMY_DIRECT_TOPIC_BOOST = 0.12
const TAXONOMY_CATEGORY_EDGE_BOOST = 0.08

export function scoreTaxonomyBoosts(input: {
  chunks: ChunkIndexEntryV2[]
  taxonomy: RetrievalTaxonomyIndex | null
  queryTokens: string[]
}): Map<string, GraphBoost> {
  if (!input.taxonomy) {
    return new Map()
  }

  const matchedTopics = matchedQueryTopics(input.taxonomy, input.queryTokens)
  if (matchedTopics.size === 0) {
    return new Map()
  }

  const topicBoosts = new Map<string, GraphBoost>()
  for (const [topicSlug, boost] of matchedTopics) {
    mergeBoost(topicBoosts, topicSlug, boost)
  }
  for (const boost of categoryEdgeBoosts(input.taxonomy.categoryEdges, matchedTopics)) {
    mergeBoost(topicBoosts, boost.topicSlug, { score: boost.score, reasons: boost.reasons })
  }

  const result = new Map<string, GraphBoost>()
  for (const node of input.taxonomy.topicNodes) {
    const boost = topicBoosts.get(canonicalTopicSlug(node.slug, input.taxonomy.redirects))
    if (!boost) {
      continue
    }
    for (const chunkId of node.chunkIds) {
      mergeBoost(result, chunkId, boost)
    }
  }
  for (const chunk of input.chunks) {
    const topicSlug = chunk.pageTarget.startsWith('concepts/') ? chunk.pageTarget.slice('concepts/'.length) : null
    if (!topicSlug) {
      continue
    }
    const boost = topicBoosts.get(canonicalTopicSlug(topicSlug, input.taxonomy.redirects))
    if (boost) {
      mergeBoost(result, chunk.chunkId, boost)
    }
  }
  return result
}

function matchedQueryTopics(taxonomy: RetrievalTaxonomyIndex, queryTokens: string[]): Map<string, GraphBoost> {
  const query = new Set(queryTokens)
  const matches = new Map<string, GraphBoost>()

  for (const topic of taxonomy.topics) {
    if (tokensMatchSlugOrName(query, topic.slug, topic.name)) {
      mergeBoost(matches, canonicalTopicSlug(topic.slug, taxonomy.redirects), {
        score: TAXONOMY_DIRECT_TOPIC_BOOST,
        reasons: [`taxonomy:topic:${topic.slug}`],
      })
    }
  }

  for (const [alias, topicSlug] of Object.entries(taxonomy.aliases)) {
    if (slugTokens(alias).every((token) => query.has(token))) {
      mergeBoost(matches, canonicalTopicSlug(topicSlug, taxonomy.redirects), {
        score: TAXONOMY_ALIAS_BOOST,
        reasons: [`taxonomy:alias:${alias}`],
      })
    }
  }

  for (const [from, to] of Object.entries(taxonomy.redirects)) {
    if (slugTokens(from).every((token) => query.has(token))) {
      mergeBoost(matches, canonicalTopicSlug(to, taxonomy.redirects), {
        score: TAXONOMY_REDIRECT_BOOST,
        reasons: [`taxonomy:redirect:${from}`],
      })
    }
  }

  for (const topicSlug of categoryGraphTopicSlugs(taxonomy.categoryEdges)) {
    if (slugTokens(topicSlug).every((token) => query.has(token))) {
      mergeBoost(matches, canonicalTopicSlug(topicSlug, taxonomy.redirects), {
        score: TAXONOMY_DIRECT_TOPIC_BOOST,
        reasons: [`taxonomy:topic:${topicSlug}`],
      })
    }
  }

  return matches
}

function categoryEdgeBoosts(
  edges: TaxonomyCategoryEdge[],
  matchedTopics: Map<string, GraphBoost>,
): Array<{ topicSlug: string; score: number; reasons: string[] }> {
  const boosts: Array<{ topicSlug: string; score: number; reasons: string[] }> = []
  for (const edge of edges) {
    if (edge.status !== undefined && edge.status !== 'accepted') {
      continue
    }
    if (matchedTopics.has(edge.from)) {
      boosts.push({
        topicSlug: edge.to,
        score: TAXONOMY_CATEGORY_EDGE_BOOST,
        reasons: [`taxonomy:edge:${edge.type ?? 'related'}:${edge.from}->${edge.to}`],
      })
    }
    if (matchedTopics.has(edge.to)) {
      boosts.push({
        topicSlug: edge.from,
        score: TAXONOMY_CATEGORY_EDGE_BOOST,
        reasons: [`taxonomy:edge:${edge.type ?? 'related'}:${edge.from}<-${edge.to}`],
      })
    }
  }
  return boosts
}

function categoryGraphTopicSlugs(edges: TaxonomyCategoryEdge[]): Set<string> {
  const slugs = new Set<string>()
  for (const edge of edges) {
    if (edge.status !== undefined && edge.status !== 'accepted') {
      continue
    }
    slugs.add(edge.from)
    slugs.add(edge.to)
  }
  return slugs
}

function mergeBoost(boosts: Map<string, GraphBoost>, topicSlug: string, boost: GraphBoost): void {
  const existing = boosts.get(topicSlug)
  if (!existing) {
    boosts.set(topicSlug, { score: boost.score, reasons: [...boost.reasons] })
    return
  }
  existing.score += boost.score
  existing.reasons = [...new Set([...existing.reasons, ...boost.reasons])]
}

function canonicalTopicSlug(slug: string, redirects: Record<string, string>): string {
  let current = slug
  const seen = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    const next = redirects[current]
    if (!next || seen.has(next)) {
      return current
    }
    seen.add(current)
    current = next
  }
  return current
}

function tokensMatchSlugOrName(query: Set<string>, slug: string, name: string): boolean {
  const slugMatch = slugTokens(slug).every((token) => query.has(token))
  if (slugMatch) {
    return true
  }
  const nameTokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0)
  return nameTokens.length > 0 && nameTokens.every((token) => query.has(token))
}

function slugTokens(slug: string): string[] {
  return slug.split('-').filter((token) => token.length > 0)
}
