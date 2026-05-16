import path from 'node:path'

export type RepoSamplingLimits = {
  maxFiles: number
  maxBytes: number
}

export type LlmWikiConfig = {
  knowledgeRoot: string
  cacheDirectory: string
  jobStorePath: string
  repoSamplingLimits: RepoSamplingLimits
  urlFetchTimeoutMs: number
}

const DEFAULT_KNOWLEDGE_ROOT = path.resolve(process.cwd(), 'knowledge')
const DEFAULT_CACHE_DIRECTORY = path.resolve(process.cwd(), '.cache', 'llm-wiki')

export function loadConfig(overrides: Partial<LlmWikiConfig> = {}): LlmWikiConfig {
  const knowledgeRoot = overrides.knowledgeRoot ?? process.env.LLM_WIKI_KNOWLEDGE_ROOT ?? DEFAULT_KNOWLEDGE_ROOT
  const cacheDirectory = overrides.cacheDirectory ?? process.env.LLM_WIKI_CACHE_DIR ?? DEFAULT_CACHE_DIRECTORY

  return {
    knowledgeRoot,
    cacheDirectory,
    jobStorePath: overrides.jobStorePath ?? process.env.LLM_WIKI_JOB_STORE_PATH ?? path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
    repoSamplingLimits: overrides.repoSamplingLimits ?? {
      maxFiles: 200,
      maxBytes: 5 * 1024 * 1024,
    },
    urlFetchTimeoutMs: overrides.urlFetchTimeoutMs ?? Number(process.env.LLM_WIKI_URL_FETCH_TIMEOUT_MS ?? 15_000),
  }
}
