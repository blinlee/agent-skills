import { readFileSync } from 'node:fs'
import { hostLocalConfigPaths } from './embedding-config.js'

export type HydeConfig = {
  endpoint: string
  model: string | null
  timeoutMs: number
  promptTemplate: string
}

export type HydeGenerator = {
  generate(input: {
    question: string
    config: HydeConfig
  }): Promise<string>
}

const DEFAULT_HYDE_TIMEOUT_MS = 30_000
const DEFAULT_HYDE_PROMPT_TEMPLATE = 'Write a passage that answers the question: {question}'

type HostLocalHydeConfig = Partial<{
  endpoint: string
  model: string
  timeoutMs: number
  promptTemplate: string
  prompt: string
  enabled: boolean
}>

type HostLocalConfig = {
  hydeProvider?: HostLocalHydeConfig
  hyde?: HostLocalHydeConfig
}

export function loadHydeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HydeConfig | null {
  const fileConfig = readHostLocalHydeConfig(env)
  if (fileConfig?.enabled === false && !readEnv(env, 'LLM_WIKI_HYDE_ENDPOINT')) {
    return null
  }

  const endpoint = readEnv(env, 'LLM_WIKI_HYDE_ENDPOINT') ?? normalizedString(fileConfig?.endpoint)
  if (!endpoint) {
    return null
  }

  return {
    endpoint,
    model: readEnv(env, 'LLM_WIKI_HYDE_MODEL') ?? normalizedString(fileConfig?.model),
    timeoutMs: parsePositiveInteger(
      readEnv(env, 'LLM_WIKI_HYDE_TIMEOUT_MS') ?? fileConfig?.timeoutMs,
      DEFAULT_HYDE_TIMEOUT_MS,
      'LLM_WIKI_HYDE_TIMEOUT_MS',
    ),
    promptTemplate: readEnv(env, 'LLM_WIKI_HYDE_PROMPT_TEMPLATE')
      ?? readEnv(env, 'LLM_WIKI_HYDE_PROMPT')
      ?? normalizedString(fileConfig?.promptTemplate)
      ?? normalizedString(fileConfig?.prompt)
      ?? DEFAULT_HYDE_PROMPT_TEMPLATE,
  }
}

export async function generateHydeDocument(input: {
  question: string
  diagnostics: string[]
  config?: HydeConfig | null
  generator?: HydeGenerator
}): Promise<string | null> {
  const config = input.config === undefined ? loadHydeConfigFromEnv() : input.config
  if (!config) {
    return null
  }

  const generator = input.generator ?? new LocalHttpHydeGenerator()
  try {
    const text = (await generator.generate({ question: input.question, config })).trim()
    if (!text) {
      input.diagnostics.push('hyde endpoint returned empty text; embedding raw question')
      return null
    }
    input.diagnostics.push('hyde generated hypothetical document for embedding retrieval')
    return text
  } catch (error) {
    input.diagnostics.push(`hyde unavailable; embedding raw question: ${(error as Error).message}`)
    return null
  }
}

export class LocalHttpHydeGenerator implements HydeGenerator {
  async generate(input: {
    question: string
    config: HydeConfig
  }): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
    try {
      const prompt = renderPrompt(input.config.promptTemplate, input.question)
      const response = await fetch(input.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.config.model ?? undefined,
          question: input.question,
          prompt,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
      }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error(`HyDE endpoint returned non-JSON response: ${text.slice(0, 120)}`)
      }
      return parseHydeResponse(body)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`HyDE endpoint timed out after ${input.config.timeoutMs}ms: ${input.config.endpoint}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parseHydeResponse(body: unknown): string {
  if (typeof body === 'string') {
    return body
  }
  if (!isRecord(body)) {
    throw new Error('HyDE endpoint returned a non-object JSON response.')
  }

  const direct = stringField(body, 'text')
    ?? stringField(body, 'answer')
    ?? stringField(body, 'document')
    ?? stringField(body, 'generated_text')
    ?? stringField(body, 'response')
  if (direct) {
    return direct
  }

  const choices = body.choices
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const first = choices[0]
    const text = stringField(first, 'text')
    if (text) {
      return text
    }
    if (isRecord(first.message)) {
      const content = stringField(first.message, 'content')
      if (content) {
        return content
      }
    }
  }

  throw new Error('HyDE endpoint response missing generated text.')
}

function readHostLocalHydeConfig(env: NodeJS.ProcessEnv): HostLocalHydeConfig | null {
  for (const configPath of hostLocalConfigPaths(env)) {
    const data = readJsonConfig(configPath)
    if (!data) continue
    const config = data.hydeProvider ?? data.hyde
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

function renderPrompt(template: string, question: string): string {
  return template.includes('{question}') ? template.replaceAll('{question}', question) : `${template}\n\nQuestion: ${question}`
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

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const item = value[key]
  return typeof item === 'string' && item.trim().length > 0 ? item : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
