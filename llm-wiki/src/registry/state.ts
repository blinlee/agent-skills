import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ensureKnowledgeRootLayout } from '../paths.js'
import { ensureJsonFile, readJsonFile, writeJsonFile } from '../shared/fs.js'
import type {
  RegistryAddInput,
  RegistryAddResult,
  RegistryCommandInput,
  RegistryInitResult,
  RegistryListResult,
  WikiRegistryEntry,
  WikiRegistryState,
} from './registry.js'
import { ensureTextFile, normalizeStringList, normalizeWikiId, titleFromId } from './helpers.js'
import { REGISTRY_DIRECTORIES, resolveRegistryPaths, type RegistryPaths } from './paths.js'

export async function runRegistryInit(input: RegistryCommandInput): Promise<RegistryInitResult> {
  const paths = resolveRegistryPaths(input.registryRoot)

  await Promise.all(REGISTRY_DIRECTORIES.map((directory) => mkdir(path.join(paths.root, directory), { recursive: true })))
  await ensureJsonFile(paths.registryFile, { version: 1, wikis: [] } satisfies WikiRegistryState)
  await ensureTextFile(paths.queryLog, '')
  await ensureTextFile(paths.intakeEvents, '')

  return {
    registryRoot: paths.root,
    createdDirectories: [...REGISTRY_DIRECTORIES],
    registryFile: paths.registryFile,
  }
}

export async function runRegistryAdd(input: RegistryAddInput): Promise<RegistryAddResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })

  const state = await readRegistryState(paths)
  const now = new Date().toISOString()
  const id = normalizeWikiId(input.id)
  if (!id) {
    throw new Error('registry-add requires a non-empty --id value using letters, numbers, dot, underscore, or dash.')
  }

  const knowledgeRoot = input.knowledgeRoot
    ? path.resolve(input.knowledgeRoot)
    : path.join(paths.wikisDirectory, id)
  await ensureKnowledgeRootLayout(knowledgeRoot)

  const existing = state.wikis.find((wiki) => wiki.id === id)
  const explicitScopeCore = normalizeStringList(input.scopeCore ?? [])
  const explicitScopeAdjacent = normalizeStringList(input.scopeAdjacent ?? [])
  const scopeCore = explicitScopeCore.length > 0
    ? explicitScopeCore
    : normalizeStringList(input.scope ?? existing?.scopeCore ?? existing?.scope ?? [])
  const scopeAdjacent = explicitScopeAdjacent.length > 0
    ? explicitScopeAdjacent
    : normalizeStringList(existing?.scopeAdjacent ?? [])
  const outOfScope = normalizeStringList(input.outOfScope ?? existing?.outOfScope ?? [])
  const wiki: WikiRegistryEntry = {
    id,
    title: input.title?.trim() || existing?.title || titleFromId(id),
    knowledgeRoot,
    scopeCore,
    scopeAdjacent,
    scope: [...new Set([...scopeCore, ...scopeAdjacent])],
    outOfScope,
    aliases: normalizeStringList(input.aliases ?? existing?.aliases ?? []),
    conceptAliases: existing?.conceptAliases ?? [],
    granularity: existing?.granularity ?? defaultGranularityPolicy(),
    exampleAccept: existing?.exampleAccept ?? [],
    exampleReject: existing?.exampleReject ?? [],
    profileNotes: normalizeStringList(input.profileNotes ?? existing?.profileNotes ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (existing) {
    Object.assign(existing, wiki)
  } else {
    state.wikis.push(wiki)
  }
  state.wikis.sort((left, right) => left.id.localeCompare(right.id))

  const profileFile = path.join(paths.profilesDirectory, `${wiki.id}.json`)
  await writeJsonFile(paths.registryFile, state)
  await writeJsonFile(profileFile, wiki)

  return {
    registryRoot: paths.root,
    wiki,
    registryFile: paths.registryFile,
    profileFile,
  }
}

export async function runRegistryList(input: RegistryCommandInput): Promise<RegistryListResult> {
  const paths = resolveRegistryPaths(input.registryRoot)
  await runRegistryInit({ registryRoot: paths.root })
  const state = await readRegistryState(paths)
  return {
    registryRoot: paths.root,
    wikis: state.wikis,
  }
}

export async function readRegistryState(paths: RegistryPaths): Promise<WikiRegistryState> {
  const state = await readJsonFile<WikiRegistryState>(paths.registryFile, { version: 1, wikis: [] })
  return {
    version: 1,
    wikis: state.wikis.map(normalizeWikiProfile),
  }
}

function normalizeWikiProfile(wiki: WikiRegistryEntry): WikiRegistryEntry {
  const scopeCore = normalizeStringList(wiki.scopeCore ?? wiki.scope ?? [])
  const scopeAdjacent = normalizeStringList(wiki.scopeAdjacent ?? [])
  return {
    ...wiki,
    scopeCore,
    scopeAdjacent,
    scope: [...new Set([...scopeCore, ...scopeAdjacent, ...(wiki.scope ?? [])])],
    outOfScope: normalizeStringList(wiki.outOfScope ?? []),
    aliases: normalizeStringList(wiki.aliases ?? []),
    conceptAliases: wiki.conceptAliases ?? [],
    granularity: wiki.granularity ?? defaultGranularityPolicy(),
    exampleAccept: wiki.exampleAccept ?? [],
    exampleReject: wiki.exampleReject ?? [],
    profileNotes: wiki.profileNotes ?? [],
  }
}

function defaultGranularityPolicy(): WikiRegistryEntry['granularity'] {
  return {
    preferredLevel: 'field',
    splitWhen: [
      '有独立术语体系',
      '查询意图不同',
      '材料质量或审核标准不同',
      '预期会持续积累同类材料',
      '强行放入已有 wiki 会产生高污染风险',
    ],
    doNotSplitWhen: [
      '只是一个技术变体',
      '通常和已有 wiki 一起查询',
      '共享同一批来源和概念',
      '只有单个材料且没有后续积累预期',
    ],
  }
}
