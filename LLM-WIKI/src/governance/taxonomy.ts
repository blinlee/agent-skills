import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureKnowledgeRootLayout } from '../paths'

export type TopicProposalInput = {
  name: string
  confidence: number
  rationale?: string
  aliases?: string[]
}

export type AcceptTaxonomyProposalInput = {
  slug: string
  reviewer: string
}

export type ApplyTaxonomyEffectsInput = {
  topicProposals: TopicProposalInput[]
}

export type TaxonomyRegistryState = {
  topics: Array<{
    slug: string
    name: string
    confidence: number
    rationale: string
    updatedAt: string
  }>
}

export type TaxonomyAliasesState = {
  aliases: Record<string, string>
}

export type ApplyTaxonomyEffectsResult = {
  proposalCount: number
  files: string[]
}


export type TaxonomyProposalReviewSummary = {
  slug: string
  name: string
  status: TopicProposalStatus
  confidence: number
  rationale: string
  aliases: string[]
  parentCandidates: Array<{ slug: string; name: string; confidence: number; rationale: string }>
  bridgeSuggestions: Array<{ slug: string; name: string; confidence: number; rationale: string }>
  reviewRequired: boolean
  canonicalized: boolean
  reviewer: string | null
  reviewedAt: string | null
  proposedOperation: {
    action: 'canonicalize-topic'
    effect: string
    writes: string[]
  }
  filePath: string
}

export type ListTaxonomyProposalsResult = {
  knowledgeRoot: string
  proposalCount: number
  pendingCount: number
  acceptedCount: number
  rejectedCount: number
  proposals: TaxonomyProposalReviewSummary[]
}

export type RejectTaxonomyProposalInput = {
  slug: string
  reviewer: string
  reason?: string
}

export type TopicProposalStatus = 'proposed' | 'accepted' | 'edited' | 'rejected' | 'superseded'

export type MaterializedProposal = {
  name: string
  slug: string
  confidence: number
  rationale: string
  aliases: string[]
  parentCandidates: Array<{ slug: string; name: string; confidence: number; rationale: string }>
  bridgeSuggestions: Array<{ slug: string; name: string; confidence: number; rationale: string }>
  status: TopicProposalStatus
  canonicalized: boolean
  reviewRequired: boolean
  reviewer: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}


export async function listTaxonomyProposals(root: string): Promise<ListTaxonomyProposalsResult> {
  const paths = await ensureKnowledgeRootLayout(root)
  const proposalDirectory = path.join(paths.taxonomyDirectory, 'proposals')
  const proposalFiles = (await readdir(proposalDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(proposalDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right))

  const proposals: TaxonomyProposalReviewSummary[] = []
  for (const filePath of proposalFiles) {
    const proposal = await readJsonFile<MaterializedProposal | null>(filePath, null)
    if (!proposal) {
      continue
    }
    proposals.push(summarizeProposalForReview(paths.topicRegistry, paths.taxonomyAliases, filePath, proposal))
  }

  return {
    knowledgeRoot: paths.root,
    proposalCount: proposals.length,
    pendingCount: proposals.filter((proposal) => proposal.status === 'proposed' || proposal.reviewRequired).length,
    acceptedCount: proposals.filter((proposal) => proposal.status === 'accepted').length,
    rejectedCount: proposals.filter((proposal) => proposal.status === 'rejected').length,
    proposals,
  }
}

export async function rejectTaxonomyProposal(
  root: string,
  input: RejectTaxonomyProposalInput,
): Promise<{ files: string[] }> {
  const paths = await ensureKnowledgeRootLayout(root)
  const proposalPath = path.join(paths.taxonomyDirectory, 'proposals', `${input.slug}.json`)
  const proposal = await readJsonFile<MaterializedProposal | null>(proposalPath, null)

  if (!proposal) {
    throw new Error(`Taxonomy proposal does not exist: ${input.slug}`)
  }

  if (!input.reviewer.trim()) {
    throw new Error('Taxonomy proposal rejection requires a non-empty human reviewer.')
  }

  if (proposal.status === 'accepted') {
    throw new Error(`Taxonomy proposal is already accepted and cannot be rejected without an explicit reversal workflow: ${input.slug}`)
  }

  const now = new Date().toISOString()
  const rejectedProposal: MaterializedProposal = {
    ...proposal,
    status: 'rejected',
    canonicalized: false,
    reviewRequired: false,
    reviewer: input.reviewer.trim(),
    reviewedAt: now,
    updatedAt: now,
    rationale: input.reason?.trim()
      ? `${proposal.rationale}

Rejected: ${input.reason.trim()}`
      : proposal.rationale,
  }

  await writeJsonFile(proposalPath, rejectedProposal)

  return {
    files: [proposalPath],
  }
}

export async function applyTaxonomyEffects(
  root: string,
  input: ApplyTaxonomyEffectsInput,
): Promise<ApplyTaxonomyEffectsResult> {
  const paths = await ensureKnowledgeRootLayout(root)
  const taxonomyRoot = paths.taxonomyDirectory
  const proposalDirectory = path.join(taxonomyRoot, 'proposals')

  const files = [paths.topicRegistry, paths.taxonomyAliases]

  const proposals = input.topicProposals.map(materializeProposal)
  attachBridgeSuggestions(proposals)

  for (const proposal of proposals) {
    const proposalPath = path.join(proposalDirectory, `${proposal.slug}.json`)
    const existingProposal = await readJsonFile<MaterializedProposal | null>(proposalPath, null)
    if (existingProposal?.status === 'accepted') {
      files.push(proposalPath)
      continue
    }

    await writeJsonFile(proposalPath, proposal)
    files.push(proposalPath)
  }

  await ensureJsonFile(paths.topicRegistry, { topics: [] })
  await ensureJsonFile(paths.taxonomyAliases, { aliases: {} })

  return {
    proposalCount: input.topicProposals.length,
    files,
  }
}

export async function acceptTaxonomyProposal(
  root: string,
  input: AcceptTaxonomyProposalInput,
): Promise<{ files: string[] }> {
  const paths = await ensureKnowledgeRootLayout(root)
  const proposalPath = path.join(paths.taxonomyDirectory, 'proposals', `${input.slug}.json`)
  const proposal = await readJsonFile<MaterializedProposal | null>(proposalPath, null)

  if (!proposal) {
    throw new Error(`Taxonomy proposal does not exist: ${input.slug}`)
  }

  if (!input.reviewer.trim()) {
    throw new Error('Taxonomy proposal acceptance requires a non-empty human reviewer.')
  }

  const registry = await readJsonFile<TaxonomyRegistryState>(paths.topicRegistry, { topics: [] })
  const aliases = await readJsonFile<TaxonomyAliasesState>(paths.taxonomyAliases, { aliases: {} })
  const acceptedProposal: MaterializedProposal = {
    ...proposal,
    status: 'accepted',
    canonicalized: true,
    reviewRequired: false,
    reviewer: input.reviewer.trim(),
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  upsertTopicRegistryEntry(registry, acceptedProposal)
  mergeAliases(aliases, acceptedProposal)

  await writeJsonFile(paths.topicRegistry, registry)
  await writeJsonFile(paths.taxonomyAliases, aliases)
  await writeJsonFile(proposalPath, acceptedProposal)

  return {
    files: [paths.topicRegistry, paths.taxonomyAliases, proposalPath],
  }
}


function summarizeProposalForReview(
  topicRegistryPath: string,
  aliasesPath: string,
  filePath: string,
  proposal: MaterializedProposal,
): TaxonomyProposalReviewSummary {
  return {
    slug: proposal.slug,
    name: proposal.name,
    status: proposal.status,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    aliases: proposal.aliases,
    parentCandidates: proposal.parentCandidates,
    bridgeSuggestions: proposal.bridgeSuggestions,
    reviewRequired: proposal.reviewRequired,
    canonicalized: proposal.canonicalized,
    reviewer: proposal.reviewer,
    reviewedAt: proposal.reviewedAt,
    proposedOperation: {
      action: 'canonicalize-topic',
      effect: `Accepting will add or update canonical topic "${proposal.name}" (${proposal.slug}) and merge ${proposal.aliases.length} alias(es).`,
      writes: [topicRegistryPath, aliasesPath, filePath],
    },
    filePath,
  }
}

function materializeProposal(input: TopicProposalInput): MaterializedProposal {
  const now = new Date().toISOString()
  const normalizedAliases = [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))]
  const slug = slugify(input.name)

  return {
    name: input.name,
    slug,
    confidence: Number(input.confidence.toFixed(2)),
    rationale: input.rationale ?? 'Derived from governance taxonomy side effects.',
    aliases: normalizedAliases,
    parentCandidates: buildParentCandidates(input.name, slug),
    bridgeSuggestions: [] as Array<{ slug: string; name: string; confidence: number; rationale: string }>,
    status: 'proposed',
    canonicalized: false,
    reviewRequired: true,
    reviewer: null as string | null,
    reviewedAt: null as string | null,
    createdAt: now,
    updatedAt: now,
  }
}

function upsertTopicRegistryEntry(registry: TaxonomyRegistryState, proposal: MaterializedProposal): void {
  const existing = registry.topics.find((topic) => topic.slug === proposal.slug)

  if (existing) {
    existing.name = proposal.name
    existing.confidence = proposal.confidence
    existing.rationale = proposal.rationale
    existing.updatedAt = proposal.updatedAt
    return
  }

  registry.topics.push({
    slug: proposal.slug,
    name: proposal.name,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    updatedAt: proposal.updatedAt,
  })
}

function mergeAliases(aliasesState: TaxonomyAliasesState, proposal: MaterializedProposal): void {
  for (const alias of proposal.aliases) {
    const normalizedAlias = slugify(alias)
    if (!normalizedAlias) {
      continue
    }

    aliasesState.aliases[normalizedAlias] = proposal.slug
  }
}

function buildParentCandidates(name: string, ownSlug: string): Array<{ slug: string; name: string; confidence: number; rationale: string }> {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
  const candidates = new Map<string, { slug: string; name: string; confidence: number; rationale: string }>()

  for (const word of words.slice(1)) {
    const slug = slugify(word)
    if (!slug || slug === ownSlug) {
      continue
    }

    candidates.set(slug, {
      slug,
      name: word,
      confidence: 0.45,
      rationale: `Derived as a possible parent topic from "${name}".`,
    })
  }

  return [...candidates.values()]
}

function attachBridgeSuggestions(proposals: MaterializedProposal[]): void {
  for (const proposal of proposals) {
    proposal.bridgeSuggestions = proposals
      .filter((candidate) => candidate.slug !== proposal.slug)
      .map((candidate) => ({
        slug: candidate.slug,
        name: candidate.name,
        confidence: Number(Math.min(proposal.confidence, candidate.confidence, 0.66).toFixed(2)),
        rationale: `Co-proposed with "${proposal.name}" in the same taxonomy side-effect batch.`,
      }))
  }
}

async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(targetPath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }

    throw error
  }
}

async function ensureJsonFile(targetPath: string, fallback: unknown): Promise<void> {
  try {
    await readFile(targetPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    await writeJsonFile(targetPath, fallback)
  }
}

async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, JSON.stringify(value, null, 2), 'utf8')
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (normalized) {
    return normalized
  }

  return `topic-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`
}
