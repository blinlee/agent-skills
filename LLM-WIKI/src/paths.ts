import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const defaultKnowledgeLayout = [
  'raw/inbox',
  'raw/staged',
  'raw/archive',
  'raw/rejected',
  'raw/objects',
  'assets',
  'review/queue',
  'review/low-confidence',
  'review/conflicts',
  'review/merge-candidates',
  'taxonomy',
  'taxonomy/proposals',
  'taxonomy/decisions',
  'taxonomy/disambiguation',
  'wiki/sources',
  'wiki/entities',
  'wiki/concepts',
  'wiki/syntheses',
  'wiki/comparisons',
  'wiki/queries',
  'wiki/reviews',
  'graph',
  'system/manifests',
  'system/jobs',
  'system/dedup',
  'system/adapters',
  'system/cache',
] as const

export const requiredKnowledgeFiles = [
  {
    relativePath: 'wiki/SCHEMA.md',
    initialContent: buildDefaultWikiSchema(),
  },
  {
    relativePath: 'wiki/index.md',
    initialContent: '# Wiki Index\n',
  },
  {
    relativePath: 'wiki/log.md',
    initialContent: '# Wiki Log\n',
  },
  {
    relativePath: 'system/jobs/jobs.json',
    initialContent: `${JSON.stringify({ jobs: {} }, null, 2)}\n`,
  },
  {
    relativePath: 'system/dedup/manifest.json',
    initialContent: `${JSON.stringify({ entries: {} }, null, 2)}\n`,
  },
  {
    relativePath: 'system/manifests/raw-sources.json',
    initialContent: `${JSON.stringify({ entries: {} }, null, 2)}\n`,
  },
  {
    relativePath: 'taxonomy/topic-registry.json',
    initialContent: `${JSON.stringify({ topics: [] }, null, 2)}\n`,
  },
  {
    relativePath: 'taxonomy/aliases.json',
    initialContent: `${JSON.stringify({ aliases: {} }, null, 2)}\n`,
  },
  {
    relativePath: 'taxonomy/category-graph.json',
    initialContent: `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`,
  },
  {
    relativePath: 'taxonomy/redirects.json',
    initialContent: `${JSON.stringify({ redirects: {} }, null, 2)}\n`,
  },
] as const

export type KnowledgePaths = {
  root: string
  rawInbox: string
  reviewQueue: string
  reviewMergeCandidates: string
  taxonomyDirectory: string
  topicRegistry: string
  taxonomyAliases: string
  taxonomyCategoryGraph: string
  taxonomyRedirects: string
  wikiSources: string
  wikiSchema: string
  wikiIndex: string
  wikiLog: string
  wikiComparisons: string
  wikiQueries: string
  jobDirectory: string
  jobStore: string
  dedupDirectory: string
  dedupManifest: string
  rawManifest: string
}

export function resolveKnowledgePaths(root: string): KnowledgePaths {
  const absoluteRoot = path.resolve(root)

  return {
    root: absoluteRoot,
    rawInbox: path.join(absoluteRoot, 'raw', 'inbox'),
    reviewQueue: path.join(absoluteRoot, 'review', 'queue'),
    reviewMergeCandidates: path.join(absoluteRoot, 'review', 'merge-candidates'),
    taxonomyDirectory: path.join(absoluteRoot, 'taxonomy'),
    topicRegistry: path.join(absoluteRoot, 'taxonomy', 'topic-registry.json'),
    taxonomyAliases: path.join(absoluteRoot, 'taxonomy', 'aliases.json'),
    taxonomyCategoryGraph: path.join(absoluteRoot, 'taxonomy', 'category-graph.json'),
    taxonomyRedirects: path.join(absoluteRoot, 'taxonomy', 'redirects.json'),
    wikiSources: path.join(absoluteRoot, 'wiki', 'sources'),
    wikiSchema: path.join(absoluteRoot, 'wiki', 'SCHEMA.md'),
    wikiIndex: path.join(absoluteRoot, 'wiki', 'index.md'),
    wikiLog: path.join(absoluteRoot, 'wiki', 'log.md'),
    wikiComparisons: path.join(absoluteRoot, 'wiki', 'comparisons'),
    wikiQueries: path.join(absoluteRoot, 'wiki', 'queries'),
    jobDirectory: path.join(absoluteRoot, 'system', 'jobs'),
    jobStore: path.join(absoluteRoot, 'system', 'jobs', 'jobs.json'),
    dedupDirectory: path.join(absoluteRoot, 'system', 'dedup'),
    dedupManifest: path.join(absoluteRoot, 'system', 'dedup', 'manifest.json'),
    rawManifest: path.join(absoluteRoot, 'system', 'manifests', 'raw-sources.json'),
  }
}

export async function ensureKnowledgeRootLayout(root: string): Promise<KnowledgePaths> {
  const paths = resolveKnowledgePaths(root)

  await Promise.all(
    defaultKnowledgeLayout.map((entry) => mkdir(path.join(paths.root, entry), { recursive: true })),
  )

  await Promise.all(
    requiredKnowledgeFiles.map((file) => ensureBootstrapFile(path.join(paths.root, file.relativePath), file.initialContent)),
  )

  return paths
}

async function ensureBootstrapFile(filePath: string, initialContent: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  try {
    await access(filePath)
    return
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await writeFile(filePath, initialContent, 'utf8')
}

function buildDefaultWikiSchema(): string {
  return [
    '# Wiki Schema',
    '',
    '## Purpose',
    'LLM-WIKI compiles normalized raw material into durable, interlinked markdown knowledge assets. It is a compiler-style knowledge base, not a transient chat transcript and not a database-only RAG cache.',
    '',
    '## Layers',
    '- `raw/inbox/`: short-lived human dropzone for new sources. Intake scan should quickly move entries out so scheduled agents never need to browse historical raw files.',
    '- `raw/objects/`: sharded content-addressed object store for atlas-level captured originals (`raw/objects/<sha-prefix>/<sha>/...`). Use intake ledgers to find pending work; do not scan this tree for decisions.',
    '- `raw/staged/`, `raw/archive/`, and `raw/rejected/`: sharded immutable captured evidence for per-wiki ingest. Managed raw files carry frontmatter with `source_ref`, `ingested`, and `sha256` over the body. The agent reads these but must not edit them after capture; corrections go in `wiki/`, `review/`, or `taxonomy/`.',
    '- `wiki/`: human-readable, Obsidian-compatible knowledge pages maintained by the compiler/skill.',
    '- `review/`: human/agent governance queue for low-confidence, conflicting, or merge-prone knowledge.',
    '- `taxonomy/`: open-world topic, alias, redirect, disambiguation, and category-graph governance.',
    '- `system/`: machine state such as jobs, dedup manifests, raw-source manifests, cache, and compile manifests.',
    '- `graph/`: reserved graph export/schema layer.',
    '',
    '## Page sections',
    '- `wiki/sources/`: source summaries and provenance-oriented source pages.',
    '- `wiki/entities/`: people, organizations, products, projects, models, systems, or other named durable entities.',
    '- `wiki/concepts/`: concepts, topics, techniques, mechanisms, ideas, and reusable explanations.',
    '- `wiki/syntheses/`: promoted reusable query answers or cross-source syntheses.',
    '- `wiki/comparisons/`: reserved durable side-by-side analysis pages.',
    '- `wiki/queries/`: reserved filed query results worth keeping but not yet promoted into a stronger synthesis.',
    '',
    '## Conventions',
    '- Use lowercase kebab-case slugs.',
    '- Prefer qualified wikilinks: `[[sources/source-slug|Title]]`, `[[entities/entity-slug|Title]]`, `[[concepts/concept-slug|Title]]`, `[[syntheses/synthesis-slug|Title]]`.',
    '- Add durable pages to `wiki/index.md` under the correct section.',
    '- Append meaningful actions to `wiki/log.md`.',
    '- Prefer at least two outbound links for durable entity/concept/synthesis pages when evidence allows.',
    '- Preserve provenance in page bodies or metadata. Weak claims should stay low-confidence or enter review.',
    '- Every durable page should carry frontmatter (`title`, `created`, `updated`, `type`, `tags`, `sources`, `confidence`, `contested`) so lint can surface stale, weak, or contested knowledge.',
    '- Cite raw evidence with source refs, artifact IDs, or `^[raw/... ]`-style provenance markers when synthesis spans multiple sources.',
    '',
    '## Page thresholds',
    '- Create a durable entity/concept page when it is central to one source or appears across multiple sources.',
    '- Do not create durable pages for passing mentions.',
    '- Update existing pages instead of duplicating pages for the same durable topic.',
    '- Split or refactor pages that become too long to scan quickly.',
    '- Route uncertain, conflicting, or merge-prone knowledge to review instead of hardening it silently.',
    '',
    '## Human-in-the-loop classification',
    '- Model-generated source classifications, taxonomy placements, entity merges, concept assignments, tags, and target folders are proposals until a human accepts or edits them.',
    '- Unreviewed classifications may be used for temporary routing, daily briefs, and review queues, but must not become canonical taxonomy or durable placement.',
    '- High model confidence is not approval. Default policy is `require_human_review_by_default: true` for classification governance.',
    '- Accepted classifications should record reviewer identity, review time, confidence, rationale, and source evidence.',
    '',
    '## Quality signals',
    '- `confidence: high | medium | low` may be used in frontmatter or review records.',
    '- `contested: true` and contradiction notes should be used when claims conflict.',
    '- Single-source or fast-moving claims should avoid false certainty.',
    '',
    '## Lint expectations',
    '- Detect raw source drift by recomputing each managed raw file sha256 and comparing it to frontmatter plus `system/manifests/raw-sources.json`.',
    '- Detect broken wikilinks.',
    '- Detect orphan pages not reachable from the index or other pages.',
    '- Check index completeness for durable wiki pages.',
    '- Surface low-confidence, contested, stale, oversized, or taxonomy-drift pages for review.',
    '- Warn when index sections exceed scaling thresholds and when a large wiki lacks a topic map/RAG-friendly retrieval surface.',
    '',
  ].join('\n')
}
