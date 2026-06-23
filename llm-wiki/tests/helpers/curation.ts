import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runCliFromArgv, runIngestCommand, runRouteAcceptCommand } from '../../src/cli.js'
import type { IngestCommandResult } from '../../src/cli.js'
import type { CuratedConcept, CuratedEntity, CuratedSynthesis } from '../../src/compile/semantic-curation.js'
import type { InboxQualityDecision, InboxQualityPlan } from '../../src/intake/quality-gate.js'

export function testEntity(input: {
  title: string
  quote: string
  slug?: string
  kind?: CuratedEntity['kind']
  description?: string
}): CuratedEntity {
  return {
    title: input.title,
    slug: input.slug ?? safeSlug(input.title),
    kind: input.kind ?? 'other',
    description: input.description ?? `测试 agent 明确判断 ${input.title} 是稳定实体。`,
    evidence: [{ quote: input.quote }],
  }
}

export function testConcept(input: {
  title: string
  quote: string
  slug?: string
  description?: string
}): CuratedConcept {
  return {
    title: input.title,
    slug: input.slug ?? safeSlug(input.title),
    description: input.description ?? `测试 agent 明确判断 ${input.title} 是稳定概念。`,
    evidence: [{ quote: input.quote }],
  }
}

export function testSynthesis(input: {
  title: string
  quote: string
  slug?: string
  description?: string
}): CuratedSynthesis {
  return {
    title: input.title,
    slug: input.slug ?? safeSlug(input.title),
    description: input.description ?? `测试 agent 明确判断 ${input.title} 是稳定综合页。`,
    evidence: [{ quote: input.quote }],
  }
}

export async function writeTestCurationPlan(input: {
  sourcePath: string
  curationPath?: string
  baseDir?: string
  summary?: string
  title?: string
  entities?: CuratedEntity[]
  concepts?: CuratedConcept[]
  syntheses?: CuratedSynthesis[]
  notes?: string[]
}): Promise<string> {
  const sourcePath = normalizeSourcePath(input.sourcePath)
  const source = await loadEvidenceSource(sourcePath)
  const curationPath = input.curationPath ?? path.join(input.baseDir ?? defaultCurationDir(sourcePath), `${safeSlug(sourcePath)}.curation.json`)
  await mkdir(path.dirname(curationPath), { recursive: true })
  const title = input.title ?? titleFromSource(source, sourcePath)
  const quote = evidenceQuote(source)
  const entities = input.entities ?? []
  const concepts = input.concepts ?? []
  const syntheses = input.syntheses ?? []
  const hasSemanticPages = entities.length > 0 || concepts.length > 0 || syntheses.length > 0
  await writeFile(curationPath, JSON.stringify({
    schema: 'llm-wiki.semantic-curation.v1',
    status: 'ready',
    summary: input.summary ?? `测试语义整理：${title} 已读完，可作为 wiki 资料入库。`,
    entities,
    concepts,
    syntheses,
    notes: input.notes ?? (hasSemanticPages
      ? ['测试显式 curation plan 生成语义页。']
      : [`测试显式 curation plan 判断不生成实体、概念或综合页；保留 source 和完整原文入口。证据片段：${quote}`]),
  }), 'utf8')
  return curationPath
}

export async function writeTestQualityPlan(input: {
  sourcePath: string
  qualityPath?: string
  baseDir?: string
  decision?: InboxQualityDecision
  reason?: string
  knowledgeValue?: InboxQualityPlan['knowledgeValue']
  readability?: InboxQualityPlan['readability']
  duplicateStatus?: InboxQualityPlan['duplicateAssessment']['status']
  matchedRefs?: string[]
  sourceType?: string
  blockers?: string[]
  quote?: string
}): Promise<string> {
  const sourcePath = normalizeSourcePath(input.sourcePath)
  const source = await loadEvidenceSource(sourcePath)
  const qualityPath = input.qualityPath ?? path.join(input.baseDir ?? defaultCurationDir(sourcePath), `${safeSlug(sourcePath)}.quality.json`)
  await mkdir(path.dirname(qualityPath), { recursive: true })
  const decision = input.decision ?? 'accept'
  const quote = input.quote ?? evidenceQuote(source)
  await writeFile(qualityPath, JSON.stringify({
    schema: 'llm-wiki.inbox-quality.v1',
    status: decision === 'accept' ? 'ready' : 'needs_review',
    decision,
    recommendedAction: decision,
    knowledgeValue: input.knowledgeValue ?? (decision === 'reject' ? 'none' : 'medium'),
    readability: input.readability ?? 'readable',
    duplicateAssessment: {
      status: input.duplicateStatus ?? 'new',
      matchedRefs: input.matchedRefs ?? [],
    },
    sourceType: input.sourceType ?? 'note',
    reason: input.reason ?? `测试质量判断：${titleFromSource(source, sourcePath)} 有明确知识价值，可进入 wiki。`,
    evidence: decision === 'convert' ? [] : [{ quote }],
    blockers: input.blockers ?? [],
  }), 'utf8')
  return qualityPath
}

export async function runIngestCommandWithCuration(input: Parameters<typeof runIngestCommand>[0]): Promise<IngestCommandResult> {
  const qualityPath = input.qualityPath ?? await writeTestQualityPlan({
    sourcePath: input.input,
    baseDir: path.join(path.resolve(input.knowledgeRoot), '.test-curation'),
  })
  const curationPath = input.curationPath ?? await writeTestCurationPlan({
    sourcePath: input.input,
    baseDir: path.join(path.resolve(input.knowledgeRoot), '.test-curation'),
  })
  return runIngestCommand({ ...input, qualityPath, curationPath })
}

export async function runCliIngestWithCuration(
  knowledgeRoot: string,
  sourcePath: string,
  extraArgs: string[] = [],
): Promise<unknown> {
  const curationPath = await writeTestCurationPlan({
    sourcePath,
    baseDir: path.join(path.resolve(knowledgeRoot), '.test-curation'),
  })
  const qualityPath = await writeTestQualityPlan({
    sourcePath,
    baseDir: path.join(path.resolve(knowledgeRoot), '.test-curation'),
  })
  return runCliFromArgv(['ingest', knowledgeRoot, sourcePath, '--quality', qualityPath, '--curation', curationPath, ...extraArgs])
}

export async function runRouteAcceptCommandWithCuration(input: Parameters<typeof runRouteAcceptCommand>[0]): Promise<Awaited<ReturnType<typeof runRouteAcceptCommand>>> {
  if (input.qualityPath && input.curationPath) {
    return runRouteAcceptCommand(input)
  }
  const proposalPath = path.join(path.resolve(input.registryRoot), 'registry', 'routing', 'proposals', `${input.proposalId}.json`)
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8')) as { source?: { input?: string } }
  const sourcePath = proposal.source?.input
  if (!sourcePath) {
    throw new Error(`Cannot create test curation plan for route proposal without source input: ${input.proposalId}`)
  }
  const curationPath = await writeTestCurationPlan({
    sourcePath,
    baseDir: path.join(path.resolve(input.registryRoot), '.test-curation'),
  })
  const qualityPath = await writeTestQualityPlan({
    sourcePath,
    baseDir: path.join(path.resolve(input.registryRoot), '.test-curation'),
  })
  return runRouteAcceptCommand({ ...input, qualityPath, curationPath })
}

function titleFromSource(source: string, sourcePath: string): string {
  const heading = source.split(/\r?\n/u).find((line) => line.startsWith('# '))
  return heading?.replace(/^#\s+/u, '').trim() || path.basename(sourcePath)
}

function evidenceQuote(source: string): string {
  const normalized = source
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line !== '---' && !/^[a-z_]+:\s+/iu.test(line))
  const quote = normalized[0] ?? source.trim()
  return quote.length > 160 ? quote.slice(0, 160).trim() : quote
}

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath.startsWith('http://') || sourcePath.startsWith('https://')
    ? sourcePath
    : path.resolve(sourcePath)
}

function defaultCurationDir(sourcePath: string): string {
  if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
    return path.join(process.cwd(), '.test-curation')
  }
  return path.dirname(sourcePath)
}

async function loadEvidenceSource(sourcePath: string): Promise<string> {
  if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
    const response = await fetch(sourcePath)
    return response.text()
  }

  const sourceStat = await stat(sourcePath)
  if (sourceStat.isDirectory()) {
    return readDirectoryEvidence(sourcePath)
  }

  return readFile(sourcePath, 'utf8')
}

async function readDirectoryEvidence(sourcePath: string): Promise<string> {
  const entries = await readdir(sourcePath, { withFileTypes: true })
  const readable = entries
    .filter((entry) => entry.isFile() && /\.(md|txt|ts|js|json)$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  const childDirectories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const parts: string[] = []
  for (const file of readable) {
    parts.push(await readFile(path.join(sourcePath, file.name), 'utf8'))
  }
  for (const directory of childDirectories) {
    parts.push(await readDirectoryEvidence(path.join(sourcePath, directory.name)))
  }
  if (parts.length === 0) {
    return path.basename(sourcePath)
  }
  return parts.join('\n')
}

function safeSlug(value: string): string {
  const slug = path.basename(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return slug || 'source'
}
