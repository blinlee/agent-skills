import { randomUUID } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { IngestJobResult } from '../jobs/job-runner.js'
import { loadIndexedPages } from '../query/query.js'
import { exists, readJsonFile, writeJsonFile } from '../shared/fs.js'
import { normalizeWikiId } from './helpers.js'
import { resolveRegistryPaths, type RegistryPaths } from './paths.js'
import { readRegistryState, runRegistryInit } from './state.js'
import type {
  BridgeDecisionInput,
  BridgeDecisionResult,
  BridgeIndexResult,
  BridgeListResult,
  BridgeProposal,
  CrossWikiLinkEntry,
  RegistryCommandInput,
  RouteProposal,
} from './registry.js'

export async function runBridgeIndex(input: RegistryCommandInput): Promise<BridgeIndexResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  const links: CrossWikiLinkEntry[] = []

  for (const wiki of state.wikis) {
    let indexedPages: Awaited<ReturnType<typeof loadIndexedPages>> = []
    try {
      indexedPages = await loadIndexedPages(wiki.knowledgeRoot)
    } catch {
      continue
    }
    const targetsByWiki = new Map(state.wikis.map((entry) => [entry.id, entry]))

    for (const page of indexedPages) {
      let content = ''
      try {
        content = await readFile(page.filePath, 'utf8')
      } catch {
        continue
      }

      for (const match of content.matchAll(/llm-wiki:\/\/([^/\s)\]]+)\/([^\s)\]]+)/g)) {
        const toWikiId = normalizeWikiId(match[1] ?? '')
        const toTarget = (match[2] ?? '').replace(/[.,;:]+$/g, '').replace(/\.md$/i, '')
        const targetWiki = targetsByWiki.get(toWikiId)
        let status: CrossWikiLinkEntry['status'] = 'resolved'
        if (!targetWiki) {
          status = 'unknown-wiki'
        } else {
          const targetFile = path.join(targetWiki.knowledgeRoot, 'wiki', `${toTarget}.md`)
          if (!(await exists(targetFile))) {
            status = 'missing-page'
          }
        }
        links.push({
          fromWikiId: wiki.id,
          fromTarget: page.target,
          fromFilePath: page.filePath,
          toWikiId,
          toTarget,
          raw: match[0],
          status,
        })
      }
    }
  }

  const generatedAt = new Date().toISOString()
  const bridgeFile = path.join(paths.bridgesDirectory, 'cross-wiki-links.json')
  await writeJsonFile(bridgeFile, {
    version: 1,
    registryRoot: paths.root,
    generatedAt,
    links,
  })

  return {
    registryRoot: paths.root,
    generatedAt,
    linkCount: links.length,
    unresolvedCount: links.filter((link) => link.status !== 'resolved').length,
    bridgeFile,
    links,
  }
}

export async function runBridgeList(input: RegistryCommandInput): Promise<BridgeListResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposals = await readBridgeProposals(paths)
  return {
    registryRoot: paths.root,
    proposalCount: proposals.length,
    pendingCount: proposals.filter((proposal) => proposal.status === 'proposed').length,
    proposals,
  }
}

export async function runBridgeAccept(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposal = await readBridgeProposal(paths, input.proposalId)
  if (!proposal) {
    throw new Error(`Bridge proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('bridge-accept requires --reviewer <name> after human confirmation.')
  }
  const now = new Date().toISOString()
  const accepted: BridgeProposal = {
    ...proposal,
    status: 'accepted',
    reviewer: input.reviewer.trim(),
    reviewedAt: now,
    reason: input.reason ?? null,
    updatedAt: now,
  }
  const files = [bridgeProposalFile(paths, accepted.id)]
  if (accepted.sourcePageFile) {
    await appendBridgeLinkToSourcePage(accepted.sourcePageFile, accepted.suggestedLink, accepted.rationale)
    files.push(accepted.sourcePageFile)
  }
  await writeJsonFile(bridgeProposalFile(paths, accepted.id), accepted)
  const decisionFile = path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`)
  await writeJsonFile(decisionFile, {
    proposalId: accepted.id,
    status: 'accepted',
    reviewer: accepted.reviewer,
    reason: accepted.reason,
    decidedAt: now,
    suggestedLink: accepted.suggestedLink,
  })
  files.push(decisionFile)
  return {
    registryRoot: paths.root,
    proposal: accepted,
    proposalFile: bridgeProposalFile(paths, accepted.id),
    files,
  }
}

export async function runBridgeReject(input: BridgeDecisionInput): Promise<BridgeDecisionResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const proposal = await readBridgeProposal(paths, input.proposalId)
  if (!proposal) {
    throw new Error(`Bridge proposal does not exist: ${input.proposalId}`)
  }
  if (!input.reviewer.trim()) {
    throw new Error('bridge-reject requires --reviewer <name>.')
  }
  if (!input.reason?.trim()) {
    throw new Error('bridge-reject requires --reason <reason>.')
  }
  const now = new Date().toISOString()
  const rejected: BridgeProposal = {
    ...proposal,
    status: 'rejected',
    reviewer: input.reviewer.trim(),
    reviewedAt: now,
    reason: input.reason.trim(),
    updatedAt: now,
  }
  await writeJsonFile(bridgeProposalFile(paths, rejected.id), rejected)
  return {
    registryRoot: paths.root,
    proposal: rejected,
    proposalFile: bridgeProposalFile(paths, rejected.id),
    files: [bridgeProposalFile(paths, rejected.id)],
  }
}

export async function createBridgeProposalsAfterRouteAccept(
  paths: RegistryPaths,
  proposal: RouteProposal,
  ingestResult: IngestJobResult,
  primaryWikiId: string,
): Promise<string[]> {
  const sourcePageFile = ingestResult.writtenFiles.find((filePath) => filePath.replace(/\\/g, '/').includes('/wiki/sources/')) ?? null
  const sourcePageTarget = sourcePageFile ? `sources/${path.basename(sourcePageFile, '.md')}` : null
  const files: string[] = []
  const now = new Date().toISOString()
  const secondaryWikis = proposal.classificationPackage.secondaryWikis
    .filter((secondary) => secondary.wikiId !== primaryWikiId && (secondary.relation === 'bridge' || secondary.relation === 'co-relevant'))

  for (const secondary of secondaryWikis) {
    const bridgeProposal: BridgeProposal = {
      id: `bridge-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
      status: 'proposed',
      routeProposalId: proposal.id,
      fromWikiId: primaryWikiId,
      toWikiId: secondary.wikiId,
      sourcePageTarget,
      sourcePageFile,
      suggestedLink: `llm-wiki://${secondary.wikiId}/<section>/<slug>`,
      rationale: secondary.rationale,
      reviewer: null,
      reviewedAt: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
    }
    const file = bridgeProposalFile(paths, bridgeProposal.id)
    await writeJsonFile(file, bridgeProposal)
    files.push(file)
  }

  return files
}

async function readBridgeProposals(paths: RegistryPaths): Promise<BridgeProposal[]> {
  const entries = await readdir(paths.bridgeProposalsDirectory, { withFileTypes: true })
  const proposals: BridgeProposal[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const proposal = await readJsonFile<BridgeProposal | null>(path.join(paths.bridgeProposalsDirectory, entry.name), null)
    if (proposal) {
      proposals.push(proposal)
    }
  }
  return proposals.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

async function readBridgeProposal(paths: RegistryPaths, proposalId: string): Promise<BridgeProposal | null> {
  return readJsonFile<BridgeProposal | null>(bridgeProposalFile(paths, proposalId), null)
}

function bridgeProposalFile(paths: RegistryPaths, proposalId: string): string {
  return path.join(paths.bridgeProposalsDirectory, `${proposalId}.json`)
}

async function appendBridgeLinkToSourcePage(sourcePageFile: string, suggestedLink: string, rationale: string): Promise<void> {
  const content = await readFile(sourcePageFile, 'utf8')
  if (content.includes(suggestedLink)) {
    return
  }
  const section = [
    '',
    '## 跨 wiki 连接',
    `- ${suggestedLink} — ${rationale}`,
    '',
  ].join('\n')
  await appendFile(sourcePageFile, section, 'utf8')
}
