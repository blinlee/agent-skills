import type { RetrievalScore } from '../retrieval/types.js'

export type QueryIntent = {
  domains: Set<QueryIntentDomain>
  dominantDomains: QueryIntentDomain[]
  profiles: Record<string, QueryIntentProfile>
  hasDomainSpecificIntent: boolean
  explicitCrossDomainIntent: boolean
  answerShape: QueryAnswerShape
  prefersDocumentReading: boolean
  focusedDomains: Set<QueryIntentDomain>
  hasFinanceQuantFocus: boolean
}

export type QueryIntentDomain = string

export type QueryAnswerShape = 'fact' | 'technical' | 'survey'

export type EvidenceForIntent = {
  wikiId?: string
  wikiTitle?: string
  title: string
  heading?: string
  excerpt: string
  score?: RetrievalScore
}

export type EvidenceIntentFit = {
  score: number
  positiveScore: number
  negativeScore: number
  margin: number
  strong: boolean
  domain?: QueryIntentDomain
  reasons: string[]
}

export type QueryIntentProfile = {
  domain: QueryIntentDomain
  core: string[]
  support: string[]
  generic: string[]
  negative: QueryIntentDomain[]
  focus?: string[]
}

export const DEFAULT_QUERY_INTENT_PROFILES: Record<QueryIntentDomain, QueryIntentProfile> = {
  finance: {
    domain: 'finance',
    core: [
      'quant',
      'quantitative',
      'formulaic factor',
      'financial time',
      'financial foundation',
      'portfolio',
      'trading',
      'alpha',
      'factor',
      'stock',
      'equity',
      'asset pricing',
      'return forecasting',
      '量化',
      '金融',
      '因子',
      '股票',
      '交易',
      '投资组合',
      '收益',
    ],
    support: [
      'finance',
      'financial',
      'investment',
      'risk',
      'asset',
      'market evidence',
      'time-series',
      'forecast',
      '资产',
      '投资',
      '风险',
      '预测',
    ],
    generic: ['market', 'markets', 'strategy', 'research', 'ai', 'llm', 'model'],
    negative: ['agentEngineering', 'rag', 'perception', 'automation'],
    focus: [
      'quant',
      'quantitative',
      '量化',
      'alpha',
      'factor',
      'portfolio',
      'trading',
      'forecast',
      'time-series',
      'financial time',
      'foundation model',
      'llm',
    ],
  },
  agentEngineering: {
    domain: 'agentEngineering',
    core: [
      'agent engineering',
      'coding agent',
      'coding agents',
      'software agent',
      'software agents',
      'tool use',
      'tool-use',
      'tool calling',
      'evaluation harness',
      'eval harness',
      'agent eval',
      'agent evaluation',
      'multi-agent system',
      'multi-agent systems',
      'sub-agent',
      'skill runtime',
      '技能',
      '工具调用',
      '评测框架',
      '多智能体',
    ],
    support: [
      'prompt workflow',
      'task decomposition',
      'compiler',
      'coding',
      'development',
      'workflow orchestration',
      'context engineering',
      '上下文工程',
      '任务分解',
      '工作流编排',
    ],
    generic: ['agent', 'agents', 'ai', 'evaluation', 'workflow', 'framework', 'automation'],
    negative: ['finance', 'rag', 'perception', 'automation'],
  },
  rag: {
    domain: 'rag',
    core: [
      'rag',
      'retrieval augmented',
      'retrieval-augmented',
      'graphrag',
      'lightrag',
      'vector database',
      'hybrid retrieval',
      'retrieve and rerank',
      'retrieve-and-rerank',
      'parentdocumentretriever',
      'small2big',
      'textunit',
      'knowledge graph',
      '知识图谱',
      '检索增强',
      '向量检索',
    ],
    support: [
      'embedding architecture',
      'chunk',
      'chunks',
      'chunking',
      'rerank',
      'reranker',
      'hyde',
      'bm25',
      'source passage',
      'citation',
      'context pack',
      'entity graph',
      '切片',
      '重排',
      '引用',
    ],
    generic: ['retrieval', 'embedding', 'graph', 'architecture', 'context', 'index'],
    negative: ['finance', 'agentEngineering', 'perception', 'automation'],
  },
  perception: {
    domain: 'perception',
    core: [
      '3d perception',
      '3d scene',
      'scene understanding',
      'lidar',
      'camera',
      'point cloud',
      'sensor fusion',
      'lidar-camera',
      'calibration',
      'robot perception',
      'embodied perception',
      '视觉',
      '感知',
      '点云',
      '激光雷达',
      '传感器融合',
      '相机',
      '三维场景',
    ],
    support: [
      'multimodal',
      'robot',
      'robotics',
      'autonomous driving',
      'mapping',
      'segmentation',
      'detection',
      '多模态',
      '机器人',
      '自动驾驶',
      '分割',
      '检测',
    ],
    generic: ['3d', 'perception', 'scene', 'model', 'ai'],
    negative: ['finance', 'agentEngineering', 'rag', 'automation'],
  },
  automation: {
    domain: 'automation',
    core: [
      'hook',
      'hooks',
      'automation hook',
      'state management',
      'session runtime',
      'automation task',
      'agent skill',
      '配置',
      '钩子',
      '会话',
      '自动化任务',
    ],
    support: [
      'workflow automation',
      'runtime state',
      'task runner',
      'approval gate',
      'root config',
      'workspace',
      'environment variable',
      '工作流自动化',
      '运行时',
      '环境变量',
    ],
    generic: ['automation', 'workflow', 'agent', 'tool', 'skill'],
    negative: ['finance', 'rag', 'perception'],
  },
}

const SURVEY_STRONG_TERMS = [
  '主要框架',
  '哪几种',
  '哪幾種',
  '几种路线',
  '幾種路線',
  '有哪些路线',
  '有哪些路線',
  '路线',
  '路線',
  '流派',
  '分类',
  '分類',
  '综述',
  '綜述',
  '全景',
  '图谱',
  '圖譜',
  '格局',
  'landscape',
  'taxonomy',
  'taxonomies',
  'survey',
  'overview',
  'state of the art',
  'sota',
]

const SURVEY_CONTEXT_TERMS = [
  'framework',
  'frameworks',
  'route',
  'routes',
  'approach',
  'approaches',
  'architecture',
  'architectures',
  '体系',
  '架构',
  '方案',
  '方法',
  '方向',
  '类型',
  '類型',
]

const TECHNICAL_TERMS = [
  '怎么',
  '怎样',
  '如何',
  '是什么',
  '啥',
  'why',
  'how',
  'architecture',
  'implementation',
  'mechanism',
  'design',
  'workflow',
  'pipeline',
  '方案',
  '架构',
  '方法',
  '机制',
  '流程',
]

const CROSS_DOMAIN_TERMS = [
  '关系',
  '关联',
  '结合',
  '对比',
  '比较',
  '区别',
  '差异',
  'vs',
  'versus',
  'compare',
  'comparison',
  'relationship',
  'between',
  'combine',
  'integration',
]

export function buildQueryIntent(question: string, profiles: QueryIntentProfile[] = Object.values(DEFAULT_QUERY_INTENT_PROFILES)): QueryIntent {
  const normalized = normalizeIntentText(question)
  const profilesByDomain = normalizeIntentProfiles(profiles)
  const queryScores = scoreQueryDomains(normalized, profilesByDomain)
  const domains = new Set<QueryIntentDomain>(queryScores
    .filter((entry) => entry.score >= 0.35)
    .map((entry) => entry.domain))
  const explicitCrossDomainIntent = containsAny(normalized, CROSS_DOMAIN_TERMS) && domains.size > 1
  const dominantDomains = chooseDominantDomains(queryScores, explicitCrossDomainIntent)
  for (const domain of dominantDomains) {
    domains.add(domain)
  }
  const answerShape = classifyAnswerShape(normalized)
  const focusedDomains = new Set<QueryIntentDomain>(
    [...domains].filter((domain) => containsAny(normalized, profilesByDomain[domain]?.focus ?? [])),
  )
  const hasFinanceQuantFocus = focusedDomains.has('finance')
  return {
    domains,
    dominantDomains,
    profiles: profilesByDomain,
    hasDomainSpecificIntent: domains.size > 0,
    explicitCrossDomainIntent,
    answerShape,
    prefersDocumentReading: answerShape === 'survey',
    focusedDomains,
    hasFinanceQuantFocus,
  }
}

export function scoreEvidenceIntentFit(intent: QueryIntent, evidence: EvidenceForIntent): EvidenceIntentFit {
  if (!intent.hasDomainSpecificIntent) {
    return { score: 0.5, positiveScore: 0.5, negativeScore: 0, margin: 0.5, strong: true, reasons: ['intent:neutral'] }
  }
  const domains = intent.explicitCrossDomainIntent ? [...intent.domains] : intent.dominantDomains
  const fits = domains
    .map((domain) => intent.profiles[domain])
    .filter((profile): profile is QueryIntentProfile => Boolean(profile))
    .map((profile) => scoreEvidenceForDomain(profile, evidence, intent))
  return fits.sort((left, right) => right.margin - left.margin
    || right.score - left.score
    || Number(right.strong) - Number(left.strong))[0]
    ?? { score: 0, positiveScore: 0, negativeScore: 0, margin: 0, strong: false, reasons: ['intent:no-domain-fit'] }
}

export function isEvidenceDomainConsistent(intent: QueryIntent, evidence: EvidenceForIntent, options: {
  minScore?: number
  minMargin?: number
  allowRerankOverride?: boolean
} = {}): boolean {
  if (!intent.hasDomainSpecificIntent) {
    return true
  }
  const score = evidence.score
  if (options.allowRerankOverride !== false && score && score.rerank >= 0.45) {
    return true
  }
  const fit = scoreEvidenceIntentFit(intent, evidence)
  const minScore = options.minScore ?? 0.58
  const minMargin = options.minMargin ?? 0.25
  return fit.strong && fit.score >= minScore && fit.margin >= minMargin
}

export function isMeaningfulNonEmbeddingSupport(score: RetrievalScore): boolean {
  return score.rerank >= 0.25
    || score.lexical >= 0.12
    || score.graph >= 0.1
    || score.taxonomy >= 0.1
}

export function isEmbeddingOnlyScore(score: RetrievalScore): boolean {
  return score.embedding > 0
    && score.lexical <= 0
    && score.graph <= 0
    && score.taxonomy <= 0
    && score.metadata <= 0
    && score.rerank <= 0
}

export function isStrongSemanticEvidence(input: {
  intent: QueryIntent
  evidence: EvidenceForIntent
  minEmbeddingWithDomain?: number
  minEmbeddingWithoutDomain?: number
}): boolean {
  const score = input.evidence.score
  if (!score) {
    return false
  }
  if (score.rerank >= 0.35) {
    return true
  }
  const fit = scoreEvidenceIntentFit(input.intent, input.evidence)
  const minEmbeddingWithDomain = input.minEmbeddingWithDomain ?? 0.45
  const minEmbeddingWithoutDomain = input.minEmbeddingWithoutDomain ?? 0.68
  if (input.intent.hasDomainSpecificIntent) {
    return (fit.strong && fit.margin >= 0.25 && fit.score >= 0.58 && score.embedding >= minEmbeddingWithDomain)
      || (fit.margin >= 0.15 && score.embedding >= minEmbeddingWithoutDomain)
  }
  return (score.embedding >= 0.5 && score.total >= 0.18) || score.total >= 0.4
}

export function isFinanceQuantEvidenceForIntent(intent: QueryIntent, evidence: EvidenceForIntent): boolean {
  return isFocusedEvidenceForIntent(intent, evidence)
}

export function isFocusedEvidenceForIntent(intent: QueryIntent, evidence: EvidenceForIntent): boolean {
  if (intent.focusedDomains.size === 0) {
    return true
  }
  const text = evidenceText(evidence).full
  return [...intent.focusedDomains].every((domain) => {
    const focus = intent.profiles[domain]?.focus ?? []
    return focus.length === 0 || containsAny(text, focus)
  })
}

function scoreQueryDomains(normalizedQuestion: string, profilesByDomain: Record<string, QueryIntentProfile>): Array<{ domain: QueryIntentDomain; score: number }> {
  return Object.values(profilesByDomain)
    .map((profile) => {
      const core = countMatches(normalizedQuestion, profile.core)
      const support = countMatches(normalizedQuestion, profile.support)
      const generic = countMatches(normalizedQuestion, profile.generic)
      const hasEnoughIdentity = core > 0 || support >= 2 || (support >= 1 && generic >= 2)
      const score = hasEnoughIdentity
        ? clamp01(core * 0.75 + support * 0.35 + Math.min(generic, 2) * 0.12)
        : 0
      return { domain: profile.domain, score }
    })
    .sort((left, right) => right.score - left.score)
}

function chooseDominantDomains(scores: Array<{ domain: QueryIntentDomain; score: number }>, explicitCrossDomainIntent: boolean): QueryIntentDomain[] {
  const top = scores[0]
  if (!top || top.score <= 0) {
    return []
  }
  if (explicitCrossDomainIntent) {
    return scores.filter((entry) => entry.score >= 0.35).map((entry) => entry.domain)
  }
  return scores
    .filter((entry) => entry.score >= Math.max(0.35, top.score - 0.15))
    .map((entry) => entry.domain)
}

function classifyAnswerShape(normalizedQuestion: string): QueryAnswerShape {
  if (containsAny(normalizedQuestion, SURVEY_STRONG_TERMS)) {
    return 'survey'
  }
  const asksForMany = /哪[些几幾]种|有哪些|what (?:are|is) (?:the )?(?:main|major|key)|main (?:types|routes|approaches|frameworks)/u.test(normalizedQuestion)
  if (asksForMany && containsAny(normalizedQuestion, SURVEY_CONTEXT_TERMS)) {
    return 'survey'
  }
  if (containsAny(normalizedQuestion, TECHNICAL_TERMS)) {
    return 'technical'
  }
  return 'fact'
}

function scoreEvidenceForDomain(profile: QueryIntentProfile, evidence: EvidenceForIntent, intent: QueryIntent): EvidenceIntentFit {
  const text = evidenceText(evidence)
  const identityCore = countMatches(text.identity, profile.core)
  const fullCore = countMatches(text.full, profile.core)
  const identitySupport = countMatches(text.identity, profile.support)
  const fullSupport = countMatches(text.full, profile.support)
  const generic = countMatches(text.full, profile.generic)
  const negative = negativeDomainPressure(profile, text, intent.profiles)
  const positive = clamp01(
    identityCore * 0.7
    + Math.max(0, fullCore - identityCore) * 0.4
    + identitySupport * 0.25
    + Math.max(0, fullSupport - identitySupport) * 0.15
    + Math.min(generic, 2) * 0.05,
  )
  const focusPenalty = intent.focusedDomains.has(profile.domain) && !containsAny(text.full, profile.focus ?? []) ? 0.35 : 0
  const negativeScore = clamp01(negative + focusPenalty)
  const margin = Number((positive - negativeScore).toFixed(6))
  const strong = (identityCore > 0 || fullCore > 0 || identitySupport + fullSupport >= 2)
    && margin >= 0.25
    && positive >= 0.45
  const score = clamp01(positive - negativeScore)
  return {
    score,
    positiveScore: positive,
    negativeScore,
    margin,
    strong,
    domain: profile.domain,
    reasons: [
      `intent:${profile.domain}`,
      `positive:${positive.toFixed(2)}`,
      `negative:${negativeScore.toFixed(2)}`,
      `margin:${margin.toFixed(2)}`,
      strong ? 'strong' : 'weak',
    ],
  }
}

function negativeDomainPressure(profile: QueryIntentProfile, text: { identity: string; full: string }, profilesByDomain: Record<string, QueryIntentProfile>): number {
  let pressure = 0
  for (const domain of profile.negative) {
    const negativeProfile = profilesByDomain[domain]
    if (!negativeProfile) {
      continue
    }
    const identityMatches = countMatches(text.identity, negativeProfile.core)
    const fullMatches = countMatches(text.full, negativeProfile.core)
    pressure += identityMatches * 0.5 + Math.max(0, fullMatches - identityMatches) * 0.25
  }
  return clamp01(pressure)
}

function normalizeIntentProfiles(profiles: QueryIntentProfile[]): Record<string, QueryIntentProfile> {
  return Object.fromEntries(profiles.map((profile) => [profile.domain, {
    ...profile,
    core: uniqueNormalizedTerms(profile.core),
    support: uniqueNormalizedTerms(profile.support),
    generic: uniqueNormalizedTerms(profile.generic),
    focus: uniqueNormalizedTerms(profile.focus ?? []),
    negative: [...new Set(profile.negative)],
  }]))
}

function uniqueNormalizedTerms(terms: string[]): string[] {
  return [...new Set(terms.map(normalizeIntentText).filter(Boolean))]
}

function evidenceText(evidence: EvidenceForIntent): { identity: string; full: string } {
  const identity = normalizeIntentText([
    evidence.wikiId,
    evidence.wikiTitle,
    evidence.title,
    evidence.heading,
  ].filter(Boolean).join(' '))
  const full = normalizeIntentText([
    identity,
    evidence.excerpt,
  ].filter(Boolean).join(' '))
  return { identity, full }
}

function normalizeIntentText(value: string): string {
  return value.toLowerCase().replace(/[_/|:：,，.。;；()（）\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term))
}

function countMatches(value: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))))
}
