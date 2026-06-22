import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { hostLocalConfigPaths } from './embedding-config.js'
import type { ParsedArtifact } from '../parsers/base.js'
import type { SourceKind } from '../types.js'

export type ExtractedEntity = {
  name: string
  type: string
  description: string
}

export type ExtractedRelationship = {
  source: string
  target: string
  keywords: string[]
  description: string
}

export type EntityKeyValue = {
  key: string
  value: string
  kind: 'entity' | 'relationship'
  source?: string
  target?: string
}

export type EntityExtractionRecord = {
  pageTarget: string
  pageTitle: string
  sourceRef: string | null
  sourceIdentity: string | null
  sourceKind: SourceKind
  contentSha256: string
  extractedAt: string
  provider: 'local-http'
  model: string | null
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
  keyValues: EntityKeyValue[]
}

export type EntityExtractionIndex = {
  version: 1
  schema: 'llm-wiki.entity-extractions.v1'
  knowledgeRoot: string
  generatedAt: string
  records: EntityExtractionRecord[]
}

export type EntityExtractionConfig = {
  endpoint: string
  model: string | null
  timeoutMs: number
  maxRecords: number
  maxEntityRecords: number
  maxInputChars: number
  language: string
  promptTemplate: string
}

export type EntityExtractionGenerator = {
  extract(input: {
    artifact: Pick<ParsedArtifact, 'title' | 'content'>
    pageTarget: string
    config: EntityExtractionConfig
  }): Promise<Pick<EntityExtractionRecord, 'entities' | 'relationships'>>
}

export type RunEntityExtractionResult = {
  status: 'extracted' | 'skipped'
  reason?: string
  record?: EntityExtractionRecord
  filePath: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RECORDS = 24
const DEFAULT_MAX_ENTITY_RECORDS = 12
const DEFAULT_MAX_INPUT_CHARS = 12_000
const DEFAULT_LANGUAGE = '中文'
const DEFAULT_PROMPT_TEMPLATE = [
  'You are a Knowledge Graph Specialist.',
  'Extract meaningful entities and direct relationships from the input text only.',
  'Return one valid JSON object with two arrays: entities and relationships.',
  'Each entity has: name, type, description.',
  'Each relationship has: source, target, keywords, description.',
  'Only include relationships whose source and target are both included entities.',
  'Prefer high-value concepts, systems, methods, datasets, people, organizations, projects, and events.',
  'Write descriptions and relationship keywords in {language}; keep proper names unchanged.',
  'Do not invent facts. Output at most {maxRecords} total records and at most {maxEntityRecords} entities.',
  '',
  'Title: {title}',
  'Page: {pageTarget}',
  '',
  'Input text:',
  '```',
  '{inputText}',
  '```',
].join('\n')

type HostLocalEntityExtractionConfig = Partial<{
  endpoint: string
  model: string
  timeoutMs: number
  maxRecords: number
  maxEntityRecords: number
  maxInputChars: number
  language: string
  promptTemplate: string
  prompt: string
  enabled: boolean
}>

type HostLocalConfig = {
  entityExtractionProvider?: HostLocalEntityExtractionConfig
  entityExtraction?: HostLocalEntityExtractionConfig
  entityProvider?: HostLocalEntityExtractionConfig
}

export function entityExtractionIndexPath(knowledgeRoot: string): string {
  return path.join(path.resolve(knowledgeRoot), 'system', 'index', 'entity-extractions.json')
}

export function loadEntityExtractionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EntityExtractionConfig | null {
  const fileConfig = readHostLocalEntityExtractionConfig(env)
  if (fileConfig?.enabled === false && !readEnv(env, 'LLM_WIKI_ENTITY_ENDPOINT')) {
    return null
  }

  const endpoint = readEnv(env, 'LLM_WIKI_ENTITY_ENDPOINT') ?? normalizedString(fileConfig?.endpoint)
  if (!endpoint) {
    return null
  }

  return {
    endpoint,
    model: readEnv(env, 'LLM_WIKI_ENTITY_MODEL') ?? normalizedString(fileConfig?.model),
    timeoutMs: parsePositiveInteger(
      readEnv(env, 'LLM_WIKI_ENTITY_TIMEOUT_MS') ?? fileConfig?.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      'LLM_WIKI_ENTITY_TIMEOUT_MS',
    ),
    maxRecords: parsePositiveInteger(
      readEnv(env, 'LLM_WIKI_ENTITY_MAX_RECORDS') ?? fileConfig?.maxRecords,
      DEFAULT_MAX_RECORDS,
      'LLM_WIKI_ENTITY_MAX_RECORDS',
    ),
    maxEntityRecords: parsePositiveInteger(
      readEnv(env, 'LLM_WIKI_ENTITY_MAX_ENTITY_RECORDS') ?? fileConfig?.maxEntityRecords,
      DEFAULT_MAX_ENTITY_RECORDS,
      'LLM_WIKI_ENTITY_MAX_ENTITY_RECORDS',
    ),
    maxInputChars: parsePositiveInteger(
      readEnv(env, 'LLM_WIKI_ENTITY_MAX_INPUT_CHARS') ?? fileConfig?.maxInputChars,
      DEFAULT_MAX_INPUT_CHARS,
      'LLM_WIKI_ENTITY_MAX_INPUT_CHARS',
    ),
    language: readEnv(env, 'LLM_WIKI_ENTITY_LANGUAGE') ?? normalizedString(fileConfig?.language) ?? DEFAULT_LANGUAGE,
    promptTemplate: readEnv(env, 'LLM_WIKI_ENTITY_PROMPT_TEMPLATE')
      ?? readEnv(env, 'LLM_WIKI_ENTITY_PROMPT')
      ?? normalizedString(fileConfig?.promptTemplate)
      ?? normalizedString(fileConfig?.prompt)
      ?? DEFAULT_PROMPT_TEMPLATE,
  }
}

export async function runEntityExtraction(input: {
  knowledgeRoot: string
  artifact: ParsedArtifact
  pageTarget: string
  pageTitle: string
  sourceIdentity: string
  sourceKind: SourceKind
  now?: string
  config?: EntityExtractionConfig | null
  generator?: EntityExtractionGenerator
}): Promise<RunEntityExtractionResult> {
  const filePath = entityExtractionIndexPath(input.knowledgeRoot)
  const config = input.config === undefined ? loadEntityExtractionConfigFromEnv() : input.config
  if (!config) {
    return { status: 'skipped', reason: 'entity extraction provider not configured', filePath }
  }

  const generator = input.generator ?? new LocalHttpEntityExtractionGenerator()
  const extracted = await generator.extract({
    artifact: input.artifact,
    pageTarget: input.pageTarget,
    config,
  })
  const record = normalizeExtractionRecord({
    knowledgeRoot: input.knowledgeRoot,
    artifact: input.artifact,
    pageTarget: input.pageTarget,
    pageTitle: input.pageTitle,
    sourceIdentity: input.sourceIdentity,
    sourceKind: input.sourceKind,
    provider: 'local-http',
    model: config.model,
    extractedAt: input.now ?? new Date().toISOString(),
    entities: extracted.entities,
    relationships: extracted.relationships,
  })

  await upsertEntityExtractionRecord(input.knowledgeRoot, record)
  return { status: 'extracted', record, filePath }
}

export async function loadEntityExtractionIndex(knowledgeRoot: string): Promise<EntityExtractionIndex> {
  const root = path.resolve(knowledgeRoot)
  const filePath = entityExtractionIndexPath(root)
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<EntityExtractionIndex>
    if (parsed.version !== 1 || parsed.schema !== 'llm-wiki.entity-extractions.v1' || !Array.isArray(parsed.records)) {
      return emptyEntityExtractionIndex(root)
    }
    return {
      version: 1,
      schema: 'llm-wiki.entity-extractions.v1',
      knowledgeRoot: root,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date(0).toISOString(),
      records: parsed.records.flatMap(normalizePersistedRecord),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyEntityExtractionIndex(root)
    }
    throw error
  }
}

export async function upsertEntityExtractionRecord(knowledgeRoot: string, record: EntityExtractionRecord): Promise<EntityExtractionIndex> {
  const root = path.resolve(knowledgeRoot)
  const existing = await loadEntityExtractionIndex(root)
  const records = [
    ...existing.records.filter((item) => item.pageTarget !== record.pageTarget),
    record,
  ].sort((left, right) => left.pageTarget.localeCompare(right.pageTarget))
  const next: EntityExtractionIndex = {
    version: 1,
    schema: 'llm-wiki.entity-extractions.v1',
    knowledgeRoot: root,
    generatedAt: record.extractedAt,
    records,
  }
  await mkdir(path.dirname(entityExtractionIndexPath(root)), { recursive: true })
  await writeFile(entityExtractionIndexPath(root), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function supplementalEntityTextsByChunkId(input: {
  records: EntityExtractionRecord[]
  chunks: Array<{ chunkId: string; pageTarget: string }>
}): Map<string, string> {
  const firstChunkByPage = new Map<string, string>()
  for (const chunk of input.chunks) {
    if (!firstChunkByPage.has(chunk.pageTarget)) {
      firstChunkByPage.set(chunk.pageTarget, chunk.chunkId)
    }
  }

  const texts = new Map<string, string>()
  for (const record of input.records) {
    const chunkId = firstChunkByPage.get(record.pageTarget)
    if (!chunkId) continue
    const value = record.keyValues.map((item) => `${item.key}: ${item.value}`).join('\n')
    if (value) {
      texts.set(chunkId, value)
    }
  }
  return texts
}

export class LocalHttpEntityExtractionGenerator implements EntityExtractionGenerator {
  async extract(input: {
    artifact: Pick<ParsedArtifact, 'title' | 'content'>
    pageTarget: string
    config: EntityExtractionConfig
  }): Promise<Pick<EntityExtractionRecord, 'entities' | 'relationships'>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
    try {
      const prompt = renderPrompt(input.config.promptTemplate, input)
      const response = await fetch(input.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.config.model ?? undefined,
          title: input.artifact.title,
          pageTarget: input.pageTarget,
          maxRecords: input.config.maxRecords,
          maxEntityRecords: input.config.maxEntityRecords,
          language: input.config.language,
          prompt,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
      }
      return parseEntityExtractionResponse(text)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Entity extraction endpoint timed out after ${input.config.timeoutMs}ms: ${input.config.endpoint}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function normalizeExtractionRecord(input: {
  knowledgeRoot: string
  artifact: ParsedArtifact
  pageTarget: string
  pageTitle: string
  sourceIdentity: string
  sourceKind: SourceKind
  provider: 'local-http'
  model: string | null
  extractedAt: string
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
}): EntityExtractionRecord {
  const entities = normalizeEntities(input.entities).slice(0, DEFAULT_MAX_ENTITY_RECORDS * 2)
  const entityNames = new Set(entities.map((entity) => normalizeName(entity.name)))
  const relationships = normalizeRelationships(input.relationships)
    .filter((relationship) => entityNames.has(normalizeName(relationship.source)) && entityNames.has(normalizeName(relationship.target)))
  return {
    pageTarget: input.pageTarget,
    pageTitle: input.pageTitle,
    sourceRef: input.artifact.sourceRef,
    sourceIdentity: input.sourceIdentity,
    sourceKind: input.sourceKind,
    contentSha256: sha256(input.artifact.content),
    extractedAt: input.extractedAt,
    provider: input.provider,
    model: input.model,
    entities,
    relationships,
    keyValues: buildKeyValues(entities, relationships),
  }
}

function parseEntityExtractionResponse(text: string): Pick<EntityExtractionRecord, 'entities' | 'relationships'> {
  const parsed = parsePossiblyNestedJson(text)
  const body = Array.isArray(parsed) ? { entities: parsed, relationships: [] } : parsed
  if (!isRecord(body)) {
    throw new Error('Entity extraction endpoint returned a non-object JSON response.')
  }
  return {
    entities: normalizeEntities(arrayField(body, 'entities')),
    relationships: normalizeRelationships(arrayField(body, 'relationships') ?? arrayField(body, 'relations')),
  }
}

function parsePossiblyNestedJson(text: string): unknown {
  const body = parseJson(stripCodeFence(text))
  if (isRecord(body)) {
    const direct = stringField(body, 'text') ?? stringField(body, 'answer') ?? stringField(body, 'response') ?? stringField(body, 'generated_text')
    if (direct) {
      return parseJson(stripCodeFence(direct))
    }
    const choices = body.choices
    if (Array.isArray(choices) && isRecord(choices[0])) {
      const first = choices[0]
      const choiceText = stringField(first, 'text')
      if (choiceText) {
        return parseJson(stripCodeFence(choiceText))
      }
      if (isRecord(first.message)) {
        const content = stringField(first.message, 'content')
        if (content) {
          return parseJson(stripCodeFence(content))
        }
      }
    }
  }
  return body
}

function normalizePersistedRecord(value: unknown): EntityExtractionRecord[] {
  if (!isRecord(value)) return []
  if (typeof value.pageTarget !== 'string' || typeof value.pageTitle !== 'string') return []
  const entities = normalizeEntities(value.entities)
  const relationships = normalizeRelationships(value.relationships)
  return [{
    pageTarget: value.pageTarget,
    pageTitle: value.pageTitle,
    sourceRef: typeof value.sourceRef === 'string' ? value.sourceRef : null,
    sourceIdentity: typeof value.sourceIdentity === 'string' ? value.sourceIdentity : null,
    sourceKind: isSourceKind(value.sourceKind) ? value.sourceKind : 'md',
    contentSha256: typeof value.contentSha256 === 'string' ? value.contentSha256 : '',
    extractedAt: typeof value.extractedAt === 'string' ? value.extractedAt : new Date(0).toISOString(),
    provider: 'local-http',
    model: typeof value.model === 'string' ? value.model : null,
    entities,
    relationships,
    keyValues: buildKeyValues(entities, relationships),
  }]
}

function normalizeEntities(value: unknown): ExtractedEntity[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!isRecord(item)) return []
    const name = normalizedString(item.name ?? item.entity_name ?? item.entityName)
    const description = normalizedString(item.description ?? item.entity_description ?? item.entityDescription)
    if (!name || !description) return []
    const key = normalizeName(name)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{
      name,
      type: normalizedString(item.type ?? item.entity_type ?? item.entityType) ?? 'Other',
      description,
    }]
  })
}

function normalizeRelationships(value: unknown): ExtractedRelationship[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!isRecord(item)) return []
    const source = normalizedString(item.source ?? item.source_entity ?? item.sourceEntity)
    const target = normalizedString(item.target ?? item.target_entity ?? item.targetEntity)
    const description = normalizedString(item.description ?? item.relationship_description ?? item.relationshipDescription)
    if (!source || !target || !description || normalizeName(source) === normalizeName(target)) return []
    const ordered = [normalizeName(source), normalizeName(target)].sort()
    const key = `${ordered[0]}->${ordered[1]}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      source,
      target,
      keywords: normalizeKeywords(item.keywords ?? item.relationship_keywords ?? item.relationshipKeywords),
      description,
    }]
  })
}

function buildKeyValues(entities: ExtractedEntity[], relationships: ExtractedRelationship[]): EntityKeyValue[] {
  return [
    ...entities.map((entity) => ({
      key: entity.name,
      value: `${entity.type}: ${entity.description}`,
      kind: 'entity' as const,
    })),
    ...relationships.map((relationship) => ({
      key: `${relationship.source} - ${relationship.target}`,
      value: [...relationship.keywords, relationship.description].filter(Boolean).join(': '),
      kind: 'relationship' as const,
      source: relationship.source,
      target: relationship.target,
    })),
  ]
}

function renderPrompt(template: string, input: {
  artifact: Pick<ParsedArtifact, 'title' | 'content'>
  pageTarget: string
  config: EntityExtractionConfig
}): string {
  return template
    .replaceAll('{title}', input.artifact.title)
    .replaceAll('{pageTarget}', input.pageTarget)
    .replaceAll('{inputText}', input.artifact.content.slice(0, input.config.maxInputChars))
    .replaceAll('{language}', input.config.language)
    .replaceAll('{maxRecords}', String(input.config.maxRecords))
    .replaceAll('{maxEntityRecords}', String(input.config.maxEntityRecords))
}

function readHostLocalEntityExtractionConfig(env: NodeJS.ProcessEnv): HostLocalEntityExtractionConfig | null {
  for (const configPath of hostLocalConfigPaths(env)) {
    const data = readJsonConfig(configPath)
    if (!data) continue
    const config = data.entityExtractionProvider ?? data.entityExtraction ?? data.entityProvider
    if (config && typeof config === 'object') {
      return config
    }
  }
  return null
}

function readJsonConfig(configPath: string): HostLocalConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed as HostLocalConfig : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function emptyEntityExtractionIndex(knowledgeRoot: string): EntityExtractionIndex {
  return {
    version: 1,
    schema: 'llm-wiki.entity-extractions.v1',
    knowledgeRoot: path.resolve(knowledgeRoot),
    generatedAt: new Date(0).toISOString(),
    records: [],
  }
}

function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => typeof item === 'string' ? item.split(',') : [])
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : []
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Entity extraction endpoint returned invalid JSON: ${value.slice(0, 160)}`)
  }
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] | null {
  const item = value[key]
  return Array.isArray(item) ? item : null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const item = value[key]
  return typeof item === 'string' && item.trim().length > 0 ? item : null
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/\s+/g, ' ') : null
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parsePositiveInteger(value: string | number | undefined | null, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`)
  }
  return parsed
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const upper = env[name]
  const lower = env[name.toLowerCase()]
  const value = upper && upper.trim().length > 0 ? upper : lower
  return value && value.trim().length > 0 ? value.trim() : null
}

function isSourceKind(value: unknown): value is SourceKind {
  return value === 'md' || value === 'txt' || value === 'url' || value === 'repo'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
