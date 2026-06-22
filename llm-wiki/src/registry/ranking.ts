import type { RouteCandidate, RouteProposal, WikiRegistryEntry } from './registry.js'
import { normalizeWikiProfile, tokenize } from './helpers.js'

export const ROUTE_STRONG_MATCH_SCORE = 5
export const ROUTE_CHILD_PROFILE_SCORE = 4
export const ROUTE_HIGH_CONFIDENCE_SCORE = 8

export const ROUTE_GENERIC_TERMS = new Set([
  'ai',
  'agent',
  'agents',
  'artificial',
  'benchmark',
  'benchmarks',
  'data',
  'dataset',
  'deep',
  'evaluation',
  'foundation',
  'framework',
  'intelligence',
  'language',
  'learning',
  'llm',
  'machine',
  'method',
  'methods',
  'model',
  'modeling',
  'models',
  'multi',
  'network',
  'networks',
  'neural',
  'paper',
  'performance',
  'quantitative',
  'research',
  'series',
  'system',
  'systems',
  'task',
  'tasks',
  'time',
  'training',
  'visual',
  'vision',
])

export type RouteEvidence = {
  score: number
  coreMatches: string[]
  aliasMatches: string[]
  phraseMatches: string[]
  adjacentMatches: string[]
  genericMatches: string[]
}

export function rankWikis(searchText: string, wikis: WikiRegistryEntry[], focusText = searchText): RouteCandidate[] {
  const sourceTokens = routeTokenSet(searchText)
  const normalizedSearchText = normalizePhraseText(searchText)
  const focusedTokens = routeTokenSet(focusText)
  const normalizedFocusText = normalizePhraseText(focusText)

  return wikis
    .map((wiki) => {
      const normalizedWiki = normalizeWikiProfile(wiki)
      const evidence = collectRouteEvidence(normalizedWiki, sourceTokens, normalizedSearchText)
      const focusedEvidence = collectRouteEvidence(normalizedWiki, focusedTokens, normalizedFocusText)
      const negativeTerms = [...new Set(normalizedWiki.outOfScope.flatMap(tokenize))]
      const negativePhraseMatches = normalizedWiki.outOfScope
        .map(normalizePhraseText)
        .filter((phrase) => phrase && phraseMatchesSource(normalizedSearchText, phrase))
      const negativeMatches = [...new Set([
        ...negativePhraseMatches,
        ...negativeTerms.filter((term) => sourceTokens.has(term)),
      ])]
      const negativeScore = negativePhraseMatches.length * 4
        + negativeTerms.filter((term) => sourceTokens.has(term)).reduce((sum, term) => sum + (isGenericRouteTerm(term) ? 0.5 : 2), 0)
      const score = Math.max(0, evidence.score - negativeScore)
      const matchedTerms = [...new Set([
        ...evidence.phraseMatches,
        ...evidence.aliasMatches,
        ...evidence.coreMatches,
        ...evidence.adjacentMatches,
        ...evidence.genericMatches,
      ])]
      return {
        wikiId: normalizedWiki.id,
        title: normalizedWiki.title,
        knowledgeRoot: normalizedWiki.knowledgeRoot,
        score: Number(score.toFixed(2)),
        matchQuality: routeMatchQuality(score, evidence),
        relationshipHint: routeRelationshipHint(score, evidence, focusedEvidence),
        matchedTerms,
        focusedMatches: routeFocusedMatches(focusedEvidence),
        coreMatches: evidence.coreMatches,
        aliasMatches: evidence.aliasMatches,
        phraseMatches: evidence.phraseMatches,
        adjacentMatches: evidence.adjacentMatches,
        genericMatches: evidence.genericMatches,
        negativeMatches,
        rationale: matchedTerms.length > 0
          ? `匹配到的范围证据：${matchedTerms.join(', ')}${negativeMatches.length > 0 ? `；排除范围命中降低了分数：${negativeMatches.join(', ')}` : ''}。`
          : '没有明确范围匹配，仅作为人工审核的兜底候选。',
      }
    })
    .sort((left, right) => right.score - left.score || left.wikiId.localeCompare(right.wikiId))
}

export function collectRouteEvidence(wiki: WikiRegistryEntry, sourceTokens: Set<string>, normalizedSearchText: string): RouteEvidence {
  const corePhrases = wiki.scopeCore
  const adjacentPhrases = wiki.scopeAdjacent
  const aliasPhrases = [
    wiki.id,
    wiki.title,
    ...wiki.aliases,
    ...wiki.conceptAliases.flatMap((group) => [group.canonical, ...group.aliases]),
    ...wiki.exampleAccept,
  ]
  const corePhraseMatches = matchedProfilePhrases(corePhrases, normalizedSearchText)
  const adjacentPhraseMatches = matchedProfilePhrases(adjacentPhrases, normalizedSearchText)
  const aliasPhraseMatches = matchedProfilePhrases(aliasPhrases, normalizedSearchText)
  const coreTokenMatches = matchedProfileTokens(corePhrases, sourceTokens)
  const adjacentTokenMatches = matchedProfileTokens(adjacentPhrases, sourceTokens)
  const aliasTokenMatches = matchedProfileTokens(aliasPhrases, sourceTokens)

  const genericMatches = [...new Set([
    ...coreTokenMatches,
    ...adjacentTokenMatches,
    ...aliasTokenMatches,
  ].filter(isGenericRouteTerm))]
  const coreMatches = coreTokenMatches.filter((term) => !isGenericRouteTerm(term))
  const adjacentMatches = adjacentTokenMatches.filter((term) => !isGenericRouteTerm(term))
  const aliasMatches = aliasTokenMatches.filter((term) => !isGenericRouteTerm(term))
  const phraseMatches = [...new Set([
    ...corePhraseMatches,
    ...aliasPhraseMatches,
    ...adjacentPhraseMatches,
  ])]
  const score =
    corePhraseMatches.length * 5
    + aliasPhraseMatches.length * 5
    + adjacentPhraseMatches.length * 2.5
    + coreMatches.length * 0.8
    + aliasMatches.length * 0.7
    + adjacentMatches.length * 0.3
    + genericMatches.length * 0.1

  return {
    score,
    coreMatches: [...new Set(coreMatches)],
    aliasMatches: [...new Set(aliasMatches)],
    phraseMatches,
    adjacentMatches: [...new Set(adjacentMatches)],
    genericMatches,
  }
}

export function matchedProfilePhrases(phrases: string[], normalizedSearchText: string): string[] {
  return [...new Set(phrases
    .map(normalizePhraseText)
    .filter((phrase) => {
      const tokens = tokenize(phrase)
      if (tokens.length === 0) {
        return false
      }
      if (tokens.length === 1 && isGenericRouteTerm(tokens[0])) {
        return false
      }
      return phraseMatchesSource(normalizedSearchText, phrase)
    }))]
}

export function matchedProfileTokens(phrases: string[], sourceTokens: Set<string>): string[] {
  return [...new Set(phrases.flatMap(tokenize).filter((term) => sourceTokens.has(term)))]
}

export function routeTokenSet(value: string): Set<string> {
  return new Set(tokenize(value).flatMap(routeTokenVariants))
}

export function routeTokenVariants(token: string): string[] {
  const variants = [token]
  if (token.endsWith('ies') && token.length > 4) {
    variants.push(`${token.slice(0, -3)}y`)
  }
  if (token.endsWith('s') && token.length > 4) {
    variants.push(token.slice(0, -1))
  }
  if (token.endsWith('ics') && token.length > 5) {
    variants.push(token.slice(0, -3))
  }
  if (token.endsWith('ic') && token.length > 4) {
    variants.push(token.slice(0, -2))
  }
  return [...new Set(variants)]
}

export function routeMatchQuality(score: number, evidence: RouteEvidence): RouteCandidate['matchQuality'] {
  if (score <= 0) {
    return 'none'
  }
  if (score >= ROUTE_STRONG_MATCH_SCORE && hasStrongRouteEvidence(evidence)) {
    return 'strong'
  }
  if (score >= 2) {
    return 'moderate'
  }
  return 'weak'
}

export function routeRelationshipHint(score: number, evidence: RouteEvidence, focusedEvidence: RouteEvidence): RouteCandidate['relationshipHint'] {
  if (score <= 0) {
    return 'unrelated'
  }
  if (score >= ROUTE_STRONG_MATCH_SCORE && hasStrongRouteEvidence(evidence)) {
    return 'same_scheme'
  }
  const focusedNonGenericCount = routeFocusedMatches(focusedEvidence).length
  if (focusedNonGenericCount >= 1 && score >= ROUTE_CHILD_PROFILE_SCORE) {
    return 'possible_child_profile'
  }
  if (focusedNonGenericCount >= 1 && score >= 2) {
    return 'adjacent_family'
  }
  return 'generic_overlap'
}

export function routeFocusedMatches(evidence: RouteEvidence): string[] {
  return [...new Set([
    ...evidence.phraseMatches,
    ...evidence.aliasMatches,
    ...evidence.coreMatches,
    ...evidence.adjacentMatches,
  ])]
}

export function hasStrongRouteEvidence(evidence: RouteEvidence): boolean {
  return evidence.phraseMatches.length > 0
}

export function isStrongRouteCandidate(candidate: RouteCandidate): boolean {
  return candidate.score >= ROUTE_STRONG_MATCH_SCORE
    && candidate.matchQuality === 'strong'
    && candidate.phraseMatches.length > 0
}

export function isGenericRouteTerm(term: string): boolean {
  return ROUTE_GENERIC_TERMS.has(term)
}

export function normalizePhraseText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function phraseMatchesSource(normalizedSearchText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) {
    return false
  }
  return normalizedSearchText === normalizedPhrase
    || normalizedSearchText.startsWith(`${normalizedPhrase} `)
    || normalizedSearchText.endsWith(` ${normalizedPhrase}`)
    || normalizedSearchText.includes(` ${normalizedPhrase} `)
}

export function focusedRouteText(source: { title: string; excerpt: string }): string {
  return `${source.title}\n${source.excerpt}`
}

export function profilePositiveTerms(wiki: WikiRegistryEntry): string[] {
  return [...new Set([
    wiki.id,
    wiki.title,
    ...wiki.aliases,
    ...wiki.scope,
    ...wiki.scopeCore,
    ...wiki.scopeAdjacent,
    ...wiki.conceptAliases.flatMap((group) => [group.canonical, ...group.aliases]),
    ...wiki.exampleAccept,
  ].flatMap(tokenize))]
}

export function buildBridgeSuggestions(candidates: RouteCandidate[]): RouteProposal['bridgeSuggestions'] {
  const strong = candidates.filter((candidate) => isStrongRouteCandidate(candidate))
  if (strong.length < 2) {
    return []
  }
  const [primary, ...others] = strong
  return others.slice(0, 2).map((candidate) => ({
    fromWikiId: primary.wikiId,
    toWikiId: candidate.wikiId,
    rationale: `两个 wiki 都强匹配（${primary.wikiId}: ${primary.score}，${candidate.wikiId}: ${candidate.score}）；建议做明确跨 wiki 连接，避免重复写正式内容。`,
  }))
}
