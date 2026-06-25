import type { QueryIntentProfile } from '../query/intent.js'
import type { RegistryRetrievalWiki } from './registry.js'

const GENERIC_PROFILE_TERMS = new Set([
  'ai',
  'agent',
  'agents',
  'architecture',
  'automation',
  'benchmark',
  'benchmarks',
  'data',
  'dataset',
  'evaluation',
  'framework',
  'frameworks',
  'graph',
  'learning',
  'llm',
  'market',
  'method',
  'methods',
  'model',
  'models',
  'research',
  'strategy',
  'system',
  'systems',
  'task',
  'tasks',
  'workflow',
])

export function queryIntentProfilesForWikis(wikis: RegistryRetrievalWiki[]): QueryIntentProfile[] {
  const profiles = wikis.map((wiki) => {
    const identityTerms = uniqueProfileTerms([wiki.wikiId, wiki.title, ...(wiki.aliases ?? [])])
    const profileScopeCore = nonGenericProfileTerms([...(wiki.scopeCore ?? []), ...(wiki.scope ?? [])])
    const profileScopeAdjacent = nonGenericProfileTerms(wiki.scopeAdjacent ?? [])
    const genericProfileTerms = genericOnlyProfileTerms([
      ...wiki.matchedTerms,
      ...(wiki.scopeCore ?? []),
      ...(wiki.scope ?? []),
      ...(wiki.scopeAdjacent ?? []),
    ])
    const coreTerms = uniqueProfileTerms([
      ...identityTerms,
      ...profileScopeCore,
    ])
    const supportTerms = uniqueProfileTerms([
      ...profileScopeAdjacent,
    ])
    return {
      domain: `wiki:${wiki.wikiId}`,
      core: coreTerms,
      support: supportTerms,
      generic: uniqueProfileTerms(genericProfileTerms.filter((term) => !coreTerms.includes(term) && !supportTerms.includes(term))),
      negative: [],
      focus: uniqueProfileTerms([...coreTerms, ...supportTerms]),
    }
  })
  const profileDomains = profiles.map((profile) => profile.domain)
  return profiles.map((profile) => ({
    ...profile,
    negative: profileDomains.filter((domain) => domain !== profile.domain),
  }))
}

export function nonGenericProfileTerms(terms: string[]): string[] {
  return terms.filter((term) => !isGenericProfileTerm(term))
}

function uniqueProfileTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
}

function genericOnlyProfileTerms(terms: string[]): string[] {
  return terms.filter(isGenericProfileTerm)
}

function isGenericProfileTerm(term: string): boolean {
  const normalized = term.toLowerCase().trim()
  if (!normalized) {
    return true
  }
  const tokens = normalized.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => GENERIC_PROFILE_TERMS.has(token))
}
