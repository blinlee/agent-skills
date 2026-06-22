import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PageIndexEntry } from '../index/wiki-index.js'
import { hostLocalConfigPaths } from './embedding-config.js'
import type { ChunkIndexStateV2 } from './types.js'

export type WikiOverviewInput = {
  knowledgeRoot: string
  maxPagesPerSection?: number
  config?: WikiOverviewGenerationConfig | null
  generator?: WikiOverviewGenerator | null
}

export type WikiOverviewResult = {
  knowledgeRoot: string
  filePath: string
  pageCount: number
  chunkCount: number
  generation: 'llm' | 'deterministic' | 'failed-fallback'
  model: string | null
  reason?: string
  sections: Array<{ section: string; pageCount: number }>
}

export type WikiOverviewGenerationConfig = {
  endpoint: string
  model: string | null
  timeoutMs: number
  maxInputChars: number
  language: string
  promptTemplate: string
}

export type WikiOverviewGenerator = {
  generate(input: {
    title: string
    sourceText: string
    config: WikiOverviewGenerationConfig
  }): Promise<string>
}

type PageIndexState = {
  pages: PageIndexEntry[]
}

type HostLocalWikiOverviewConfig = Partial<{
  endpoint: string
  model: string
  timeoutMs: number
  maxInputChars: number
  language: string
  promptTemplate: string
  prompt: string
  enabled: boolean
}>

type HostLocalConfig = {
  wikiOverviewProvider?: HostLocalWikiOverviewConfig
  wikiOverview?: HostLocalWikiOverviewConfig
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_INPUT_CHARS = 120_000
const DEFAULT_LANGUAGE = '中文'
const DEFAULT_PROMPT_TEMPLATE = [
  '你是一位严谨的知识库综述助手。请把下面的 wiki 索引和代表性片段合成为一份长期可复用的 wiki overview。',
  '',
  '要求：',
  '- 使用 {language}',
  '- 面向后续 query 的上下文理解，不写营销话术',
  '- 只基于输入材料，不编造来源外事实',
  '- 明确 wiki 的主题范围、主要分类、关键材料、已知边界和后续可查方向',
  '- 输出 Markdown，包含这些标题：## 主题范围、## 主要分类、## 关键材料、## 边界与风险、## 后续检索建议',
  '',
  'Wiki title: {title}',
  '',
  'Input:',
  '```markdown',
  '{sourceText}',
  '```',
].join('\n')

export async function runWikiOverview(input: WikiOverviewInput): Promise<WikiOverviewResult> {
  const root = path.resolve(input.knowledgeRoot)
  const indexRoot = path.join(root, 'system', 'index')
  const pages = await readPages(indexRoot)
  const chunks = await readChunks(indexRoot)
  const maxPagesPerSection = input.maxPagesPerSection ?? 12
  const sections = groupPagesBySection(pages)
  const generatedAt = new Date().toISOString()
  const deterministicOverview = renderDeterministicOverview({
    generatedAt,
    pages,
    chunks,
    sections,
    maxPagesPerSection,
  })
  const generation = await buildGeneratedOverview({
    title: path.basename(root),
    pages,
    chunks,
    deterministicOverview,
    config: input.config === undefined ? loadWikiOverviewGenerationConfigFromEnv() : input.config,
    generator: input.generator ?? null,
  })
  const content = renderOverviewDocument({
    generatedAt,
    pages,
    chunks,
    generation,
    deterministicOverview,
  })
  const filePath = path.join(indexRoot, 'wiki-overview.md')
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return {
    knowledgeRoot: root,
    filePath,
    pageCount: pages.length,
    chunkCount: chunks.length,
    generation: generation.kind,
    model: generation.model,
    ...(generation.reason ? { reason: generation.reason } : {}),
    sections: [...sections.entries()].map(([section, sectionPages]) => ({ section, pageCount: sectionPages.length })),
  }
}

async function readPages(indexRoot: string): Promise<PageIndexEntry[]> {
  const parsed = JSON.parse(await readFile(path.join(indexRoot, 'pages.json'), 'utf8')) as Partial<PageIndexState>
  return Array.isArray(parsed.pages) ? parsed.pages : []
}

async function readChunks(indexRoot: string): Promise<ChunkIndexStateV2['chunks']> {
  const parsed = JSON.parse(await readFile(path.join(indexRoot, 'chunks.json'), 'utf8')) as Partial<ChunkIndexStateV2>
  return Array.isArray(parsed.chunks) ? parsed.chunks : []
}

function groupPagesBySection(pages: PageIndexEntry[]): Map<string, PageIndexEntry[]> {
  const sections = new Map<string, PageIndexEntry[]>()
  for (const page of pages) {
    const group = sections.get(page.section) ?? []
    group.push(page)
    sections.set(page.section, group)
  }
  return new Map([...sections.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

type GeneratedOverview = {
  kind: 'llm' | 'deterministic' | 'failed-fallback'
  model: string | null
  text: string
  reason?: string
}

async function buildGeneratedOverview(input: {
  title: string
  pages: PageIndexEntry[]
  chunks: ChunkIndexStateV2['chunks']
  deterministicOverview: string
  config: WikiOverviewGenerationConfig | null
  generator: WikiOverviewGenerator | null
}): Promise<GeneratedOverview> {
  if (!input.config) {
    return { kind: 'deterministic', model: null, text: input.deterministicOverview, reason: 'overview provider not configured' }
  }
  const generator = input.generator ?? new LocalHttpWikiOverviewGenerator()
  const sourceText = buildOverviewSourceText({
    pages: input.pages,
    chunks: input.chunks,
    maxInputChars: input.config.maxInputChars,
  })
  try {
    const text = (await generator.generate({ title: input.title, sourceText, config: input.config })).trim()
    if (!text) {
      return { kind: 'failed-fallback', model: input.config.model, text: input.deterministicOverview, reason: 'overview provider returned empty text' }
    }
    return { kind: 'llm', model: input.config.model, text }
  } catch (error) {
    return {
      kind: 'failed-fallback',
      model: input.config.model,
      text: input.deterministicOverview,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function renderOverviewDocument(input: {
  generatedAt: string
  pages: PageIndexEntry[]
  chunks: ChunkIndexStateV2['chunks']
  generation: GeneratedOverview
  deterministicOverview: string
}): string {
  const frontmatter = [
    '---',
    'schema: "llm-wiki.wiki-overview.v1"',
    `generated_at: "${input.generatedAt}"`,
    `generation: "${input.generation.kind}"`,
    `model: ${input.generation.model ? JSON.stringify(input.generation.model) : 'null'}`,
    `page_count: ${input.pages.length}`,
    `chunk_count: ${input.chunks.length}`,
    ...(input.generation.reason ? [`reason: ${JSON.stringify(input.generation.reason)}`] : []),
    '---',
    '',
  ].join('\n')
  if (input.generation.kind === 'llm') {
    return `${frontmatter}# Wiki Overview\n\n> LLM 合成的长期概览，用于 query 的分层上下文。它不是原始材料，也不是人工审核结论。\n\n${input.generation.text.trim()}\n\n## Deterministic Index\n\n${stripOverviewTitle(input.deterministicOverview)}`
  }
  return `${frontmatter}${input.deterministicOverview}`
}

function renderDeterministicOverview(input: {
  generatedAt: string
  pages: PageIndexEntry[]
  chunks: ChunkIndexStateV2['chunks']
  sections: Map<string, PageIndexEntry[]>
  maxPagesPerSection: number
}): string {
  const lines = [
    '# Wiki Overview',
    '',
    '> 自动生成的长期概览，用于 query 的分层上下文。它不是人工审核结论，也不是 LLM 最终答案。',
    '',
    `Generated at: ${input.generatedAt}`,
    '',
    '## 总览',
    '',
    `- 页面数: ${input.pages.length}`,
    `- 检索片段数: ${input.chunks.length}`,
    `- 分区数: ${input.sections.size}`,
    '',
    '## 分区',
    '',
  ]

  for (const [section, pages] of input.sections) {
    lines.push(`### ${section}`, '')
    for (const page of pages.slice(0, input.maxPagesPerSection)) {
      const headings = page.headings.slice(0, 4).join(' / ')
      lines.push(`- [[${page.target}|${page.title}]]${headings ? ` — ${headings}` : ''}`)
    }
    if (pages.length > input.maxPagesPerSection) {
      lines.push(`- ... 另有 ${pages.length - input.maxPagesPerSection} 页`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function buildOverviewSourceText(input: {
  pages: PageIndexEntry[]
  chunks: ChunkIndexStateV2['chunks']
  maxInputChars: number
}): string {
  const chunksByPage = new Map<string, ChunkIndexStateV2['chunks']>()
  for (const chunk of input.chunks) {
    const group = chunksByPage.get(chunk.pageTarget) ?? []
    group.push(chunk)
    chunksByPage.set(chunk.pageTarget, group)
  }
  const lines: string[] = [
    '# Wiki source pack',
    '',
    `Pages: ${input.pages.length}`,
    `Chunks: ${input.chunks.length}`,
    '',
  ]
  for (const page of input.pages) {
    lines.push(`## ${page.title}`, `Target: ${page.target}`, `Section: ${page.section}`)
    if (page.headings.length > 0) {
      lines.push(`Headings: ${page.headings.slice(0, 8).join(' / ')}`)
    }
    for (const chunk of (chunksByPage.get(page.target) ?? []).slice(0, 2)) {
      if (chunk.sourceRef) {
        lines.push(`Source: ${chunk.sourceRef}`)
      }
      lines.push('', compact(chunk.text).slice(0, 1000))
    }
    lines.push('')
    if (lines.join('\n').length >= input.maxInputChars) {
      break
    }
  }
  const sourceText = lines.join('\n').trimEnd()
  return sourceText.length > input.maxInputChars
    ? `${sourceText.slice(0, input.maxInputChars)}\n\n...(truncated)`
    : sourceText
}

function stripOverviewTitle(content: string): string {
  return content.replace(/^# Wiki Overview\n\n/, '')
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function loadWikiOverviewGenerationConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WikiOverviewGenerationConfig | null {
  const fileConfig = readHostLocalWikiOverviewConfig(env)
  if (fileConfig?.enabled === false && !readEnv(env, 'LLM_WIKI_OVERVIEW_ENDPOINT')) {
    return null
  }
  const endpoint = readEnv(env, 'LLM_WIKI_OVERVIEW_ENDPOINT') ?? normalizedString(fileConfig?.endpoint)
  if (!endpoint) {
    return null
  }
  return {
    endpoint,
    model: readEnv(env, 'LLM_WIKI_OVERVIEW_MODEL') ?? normalizedString(fileConfig?.model),
    timeoutMs: parsePositiveInteger(readEnv(env, 'LLM_WIKI_OVERVIEW_TIMEOUT_MS') ?? fileConfig?.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxInputChars: parsePositiveInteger(readEnv(env, 'LLM_WIKI_OVERVIEW_MAX_INPUT_CHARS') ?? fileConfig?.maxInputChars, DEFAULT_MAX_INPUT_CHARS),
    language: readEnv(env, 'LLM_WIKI_OVERVIEW_LANGUAGE') ?? normalizedString(fileConfig?.language) ?? DEFAULT_LANGUAGE,
    promptTemplate: readEnv(env, 'LLM_WIKI_OVERVIEW_PROMPT_TEMPLATE')
      ?? readEnv(env, 'LLM_WIKI_OVERVIEW_PROMPT')
      ?? normalizedString(fileConfig?.promptTemplate)
      ?? normalizedString(fileConfig?.prompt)
      ?? DEFAULT_PROMPT_TEMPLATE,
  }
}

class LocalHttpWikiOverviewGenerator implements WikiOverviewGenerator {
  async generate(input: {
    title: string
    sourceText: string
    config: WikiOverviewGenerationConfig
  }): Promise<string> {
    const prompt = renderPrompt(input.config.promptTemplate, {
      title: input.title,
      sourceText: input.sourceText,
      language: input.config.language,
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
    try {
      const response = await fetch(input.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.config.model,
          title: input.title,
          language: input.config.language,
          prompt,
          messages: [
            { role: 'system', content: 'You synthesize durable wiki overviews from cited local wiki material.' },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`overview provider returned HTTP ${response.status}`)
      }
      return parseOverviewResponse(await response.text())
    } finally {
      clearTimeout(timeout)
    }
  }
}

function readHostLocalWikiOverviewConfig(env: NodeJS.ProcessEnv): HostLocalWikiOverviewConfig | null {
  for (const configPath of hostLocalConfigPaths(env)) {
    const data = readJsonFileSync<HostLocalConfig | null>(configPath, null)
    const config = data?.wikiOverviewProvider ?? data?.wikiOverview
    if (config && typeof config === 'object') {
      return config
    }
  }
  return null
}

function readJsonFileSync<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function renderPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(title|sourceText|language)\}/g, (_match, key: string) => values[key] ?? '')
}

function parseOverviewResponse(text: string): string {
  const parsed = tryParseJson(text)
  if (!parsed || typeof parsed !== 'object') {
    return text
  }
  const record = parsed as Record<string, unknown>
  const direct = stringField(record, 'overview') ?? stringField(record, 'text') ?? stringField(record, 'content') ?? stringField(record, 'response')
  if (direct) {
    return direct
  }
  const choices = record.choices
  if (Array.isArray(choices)) {
    const first = choices[0]
    if (first && typeof first === 'object') {
      const firstRecord = first as Record<string, unknown>
      const message = firstRecord.message
      if (message && typeof message === 'object') {
        const content = stringField(message as Record<string, unknown>, 'content')
        if (content) return content
      }
      const textValue = stringField(firstRecord, 'text')
      if (textValue) return textValue
    }
  }
  return text
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return env[key] ?? env[key.toLowerCase()]
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
