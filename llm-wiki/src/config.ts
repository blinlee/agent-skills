import path from 'node:path'

export type RepoSamplingLimits = {
  maxFiles: number
  maxBytes: number
}

export type ProjectConfig = {
  knowledgeRoot: string
  cacheDirectory: string
  jobStorePath: string
  repoSamplingLimits: RepoSamplingLimits
  urlFetchTimeoutMs: number
}

const DEFAULT_KNOWLEDGE_ROOT = path.resolve(process.cwd(), 'knowledge')
const DEFAULT_CACHE_DIRECTORY = path.resolve(process.cwd(), '.cache', 'llm-wiki')

export function loadConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  const knowledgeRoot = overrides.knowledgeRoot ?? process.env.llm_wiki_root ?? DEFAULT_KNOWLEDGE_ROOT
  const cacheDirectory = overrides.cacheDirectory ?? process.env.llm_wiki_cache_dir ?? DEFAULT_CACHE_DIRECTORY

  return {
    knowledgeRoot,
    cacheDirectory,
    jobStorePath: overrides.jobStorePath ?? process.env.llm_wiki_job_store_path ?? path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
    repoSamplingLimits: overrides.repoSamplingLimits ?? {
      maxFiles: 200,
      maxBytes: 5 * 1024 * 1024,
    },
    urlFetchTimeoutMs: overrides.urlFetchTimeoutMs ?? Number(process.env.llm_wiki_url_fetch_timeout_ms ?? 15_000),
  }
}
