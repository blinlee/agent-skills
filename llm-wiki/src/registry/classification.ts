import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { loadIndexedPages } from '../query/query.js'
import { extractTitle, normalizeWhitespace, STOP_WORDS, titleFromId, tokenize } from './helpers.js'
import { resolveRegistryPaths, type RegistryPaths } from './paths.js'
import { isStrongRouteCandidate } from './ranking.js'
import type { ClassificationPackage, RouteCandidate, RouteDecisionType, RouteProposal, WikiRegistryEntry } from './registry.js'
import type { SourceSummary } from './source.js'

export const CLASSIFICATION_TOPIC_NOISE_WORDS = new Set([
  ...STOP_WORDS,
  'article',
  'author',
  'background',
  'build',
  'building',
  'built',
  'choose',
  'choosing',
  'complete',
  'configure',
  'configuring',
  'debug',
  'debugging',
  'digest',
  'doc',
  'docs',
  'documentation',
  'effective',
  'example',
  'examples',
  'existing',
  'guide',
  'include',
  'including',
  'index',
  'lesson',
  'lessons',
  'long',
  'note',
  'notes',
  'official',
  'overview',
  'reference',
  'related',
  'running',
  'saved',
  'source',
  'title',
  'url',
])

export async function buildClassificationPackage(paths: RegistryPaths, input: {
  routeProposalId: string
  intakeItemId: string | null
  source: SourceSummary
  candidates: RouteCandidate[]
  wikis: WikiRegistryEntry[]
  recommendedWikiId: string | null
  confidence: 'low' | 'medium' | 'high'
  bridgeSuggestions: RouteProposal['bridgeSuggestions']
  newWikiProposalId: string | null
  decisionType: RouteDecisionType
  createdAt: string
}): Promise<ClassificationPackage> {
  const topics = buildPackageTopics(input.source)
  const tags = [...new Set(topics.map((topic) => topic.slug))]
  const relatedPages = await collectRelatedPages(input.source, input.wikis)
  const primaryWiki = input.recommendedWikiId
    ? {
        wikiId: input.recommendedWikiId,
        confidence: input.confidence,
        rationale: `建议作为主归属 wiki；当前路由判断为 ${input.decisionType}。`,
      }
    : null
  const topScore = input.candidates[0]?.score ?? 0
  const secondaryWikis = input.candidates
    .filter((candidate) => candidate.wikiId !== input.recommendedWikiId && candidate.score > 0)
    .slice(0, 4)
    .map((candidate) => ({
      wikiId: candidate.wikiId,
      relation: (isStrongRouteCandidate(candidate) && topScore - candidate.score <= 1 ? 'co-relevant' : isStrongRouteCandidate(candidate) ? 'bridge' : 'possible-secondary') as ClassificationPackage['secondaryWikis'][number]['relation'],
      confidence: scoreToConfidence(candidate.score),
      rationale: isStrongRouteCandidate(candidate)
        ? `也有较强匹配（${candidate.score}）；建议作为次级/桥接关系，不要静默复制内容。`
        : `只有弱相关信号（${candidate.score}）；除非人工确认，否则只作为参考。`,
    }))

  return {
    id: `class-${input.createdAt.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
    routeProposalId: input.routeProposalId,
    intakeItemId: input.intakeItemId,
    humanReviewRequired: true,
    sourceTitle: input.source.title,
    primaryWiki,
    secondaryWikis,
    topics,
    tags,
    relatedPages,
    linkSuggestions: buildLinkSuggestions(primaryWiki?.wikiId ?? null, relatedPages, input.bridgeSuggestions),
    proposedOperations: buildClassificationOperations(paths, input.routeProposalId, input.intakeItemId, input.newWikiProposalId, input.decisionType, input.recommendedWikiId),
    reviewQuestions: [
      '主 wiki 是否分类正确？如果不对，应暂存还是拒收？',
      '次级 wiki 是合理的交叉连接，还是其实也应该共同负责？',
      '哪些主题/标签值得在收入后保留为正式分类？',
      '哪些相关页面/跨 wiki 连接是真有用的，哪些应该删掉？',
    ],
    createdAt: input.createdAt,
  }
}

export function buildPackageTopics(source: SourceSummary): ClassificationPackage['topics'] {
  const terms = extractClassificationTopicTerms(source, 8)
  const [root, ...children] = terms
  if (!root) {
    return []
  }
  const rootTopic = {
    slug: root,
    title: titleFromId(root),
    level: 1,
    parentSlug: null,
    confidence: 0.72,
    rationale: '材料中最核心的主题候选，需要人工确认是否保留。',
  }
  return [
    rootTopic,
    ...children.map((term, index) => ({
      slug: term,
      title: titleFromId(term),
      level: index < 3 ? 2 : 3,
      parentSlug: root,
      confidence: Number(Math.max(0.48, 0.68 - index * 0.03).toFixed(2)),
      rationale: '从标题/正文提取的候选主题，接受前只是草稿分类。',
    })),
  ]
}

export function extractClassificationTopicTerms(source: SourceSummary, limit: number): string[] {
  return [
    ...extractTitleTopicCandidates(source.title),
    ...extractProfileTerms(source.searchText, source.title, limit * 2).filter(isUsefulClassificationTopicToken),
  ]
    .filter((term) => term.length > 0)
    .filter((term, index, terms) => terms.indexOf(term) === index)
    .slice(0, limit)
}

export function extractTitleTopicCandidates(title: string): string[] {
  const candidates = new Set<string>()
  const normalizedTitle = normalizeClassificationTitle(title)

  for (const segment of splitClassificationTitleSegments(normalizedTitle)) {
    addTitleTopicCandidate(candidates, segment)

    for (const subSegment of segment.split(/\b(?:for|using|with|to|and|of)\b/gi)) {
      addTitleTopicCandidate(candidates, subSegment)
    }

    const forMatch = segment.match(/^(.+?)\s+for\s+(.+)$/i)
    if (forMatch) {
      addTitleTopicCandidate(candidates, forMatch[1] ?? '')
      addTitleTopicCandidate(candidates, forMatch[2] ?? '')
    }
  }

  return [...candidates]
}

export function normalizeClassificationTitle(title: string): string {
  return title
    .replace(/^#+\s*/, '')
    .replace(/\bcomplete official documentation\b/gi, '')
    .replace(/\bofficial documentation\b/gi, '')
    .replace(/\bsaved[_\s-]*date\b.*$/gi, '')
    .replace(/\bsource[_\s-]*url\b.*$/gi, '')
    .replace(/[“”"']/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function splitClassificationTitleSegments(title: string): string[] {
  return title
    .split(/\s+(?:[-–—:])\s+|[:：]/g)
    .map((segment) => segment.replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `))
    .flatMap((segment) => segment.split(/\s{2,}/g))
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function addTitleTopicCandidate(candidates: Set<string>, rawPhrase: string): void {
  const slug = slugifyClassificationTopic(rawPhrase)
  if (isUsefulClassificationTopic(slug)) {
    candidates.add(slug)
  }
}

export function slugifyClassificationTopic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !CLASSIFICATION_TOPIC_NOISE_WORDS.has(token))
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isUsefulClassificationTopic(slug: string): boolean {
  const tokens = slug.split('-').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 5) {
    return false
  }
  if (tokens.length === 1) {
    return isUsefulClassificationTopicToken(tokens[0])
  }
  return tokens.some(isUsefulClassificationTopicToken)
}

export function isUsefulClassificationTopicToken(token: string): boolean {
  if (CLASSIFICATION_TOPIC_NOISE_WORDS.has(token)) {
    return false
  }
  if (/^\d+$/.test(token)) {
    return false
  }
  if (/^[\p{L}\p{N}]+$/u.test(token) && token.length < 3) {
    return false
  }
  return true
}

export async function collectRelatedPages(source: SourceSummary, wikis: WikiRegistryEntry[]): Promise<ClassificationPackage['relatedPages']> {
  const sourceTokens = new Set(tokenize(source.searchText))
  const related: ClassificationPackage['relatedPages'] = []

  for (const wiki of wikis) {
    let pages: Awaited<ReturnType<typeof loadIndexedPages>> = []
    try {
      pages = await loadIndexedPages(wiki.knowledgeRoot)
    } catch {
      continue
    }
    for (const page of pages) {
      const pageTokens = tokenize(`${page.title} ${page.target}`)
      const overlap = pageTokens.filter((token) => sourceTokens.has(token))
      if (overlap.length === 0) {
        continue
      }
      related.push({
        wikiId: wiki.id,
        target: page.target,
        title: page.title,
        relationship: overlap.length >= 3 ? 'same-topic' : 'supporting-context',
        confidence: Number(Math.min(0.9, 0.45 + overlap.length * 0.12).toFixed(2)),
        rationale: `相关页面匹配词：${[...new Set(overlap)].slice(0, 6).join(', ')}。`,
      })
    }
  }

  return related
    .sort((left, right) => right.confidence - left.confidence || left.wikiId.localeCompare(right.wikiId) || left.target.localeCompare(right.target))
    .slice(0, 8)
}

export function buildLinkSuggestions(
  primaryWikiId: string | null,
  relatedPages: ClassificationPackage['relatedPages'],
  bridgeSuggestions: RouteProposal['bridgeSuggestions'],
): ClassificationPackage['linkSuggestions'] {
  const relatedLinks = relatedPages.slice(0, 6).map((page) => ({
    wikiId: page.wikiId,
    link: primaryWikiId && page.wikiId !== primaryWikiId
      ? `llm-wiki://${page.wikiId}/${page.target}`
      : `[[${page.target}|${page.title}]]`,
    target: page.target,
    rationale: page.rationale,
  }))
  const bridgeLinks = bridgeSuggestions.map((bridge) => ({
    wikiId: bridge.toWikiId,
    link: `llm-wiki://${bridge.toWikiId}/<section>/<slug>`,
    target: '<section>/<slug>',
    rationale: bridge.rationale,
  }))
  return [...relatedLinks, ...bridgeLinks]
}

export function buildClassificationOperations(
  paths: RegistryPaths,
  routeProposalId: string,
  intakeItemId: string | null,
  newWikiProposalId: string | null,
  decisionType: RouteDecisionType,
  recommendedWikiId: string | null,
): ClassificationPackage['proposedOperations'] {
  const operations: ClassificationPackage['proposedOperations'] = []
  if (recommendedWikiId) {
    operations.push({
      action: 'accept-primary-route',
      command: `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(routeProposalId)} --wiki ${shellQuote(recommendedWikiId)} --reviewer <name> --quality <quality.json> --curation <curation.json>`,
      requiresHumanApproval: true,
      rationale: '人工确认主 wiki 分类正确后，再接受路由并收入材料。',
    })
  }
  if (newWikiProposalId) {
    operations.push({
      action: 'accept-new-profile',
      command: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(newWikiProposalId)} --reviewer <name>`,
      requiresHumanApproval: true,
      rationale: '只有确认这是稳定知识边界时，才创建新的 wiki/profile。',
    })
  }
  if (decisionType === 'bridge_existing_wikis') {
    operations.push({
      action: 'review-bridge',
      command: 'llm-wiki bridge-list <registryRoot>',
      requiresHumanApproval: true,
      rationale: '接受路由后，先审核跨 wiki 连接是否合理，再写入链接。',
    })
  }
  operations.push({
    action: 'review-taxonomy',
    command: 'llm-wiki taxonomy-list <acceptedKnowledgeRoot>',
    requiresHumanApproval: true,
    rationale: '这里的主题/标签只是候选分类，正式保留前需要审核。',
  })
  if (intakeItemId) {
    operations.push({
      action: 'park',
      command: `llm-wiki intake-park ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
      requiresHumanApproval: true,
      rationale: '材料可能有价值，但暂时不适合确定分类或新建 wiki 时使用。',
    }, {
      action: 'reject',
      command: `llm-wiki intake-reject ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
      requiresHumanApproval: true,
      rationale: '材料不应进入当前 atlas，或必须先转换格式时使用。',
    })
  }
  return operations
}

export function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 8) return 'high'
  if (score >= 5) return 'medium'
  return 'low'
}

export function extractProfileTerms(searchText: string, title: string, limit: number): string[] {
  const titleTokens = tokenize(title)
  const counts = new Map<string, number>()
  for (const token of [...titleTokens, ...tokenize(searchText)]) {
    if (token.length < 3) {
      continue
    }
    counts.set(token, (counts.get(token) ?? 0) + (titleTokens.includes(token) ? 3 : 1))
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, limit)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
