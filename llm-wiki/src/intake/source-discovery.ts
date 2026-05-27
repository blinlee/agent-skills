import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { SOURCE_KINDS, type SourceKind } from '../types.js'

export type DiscoveredSourceKind = SourceKind | 'unknown'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown'])
const TEXT_EXTENSIONS = new Set(['.txt', '.text'])

export function isLikelyUrlSource(source: string): boolean {
  try {
    const parsed = new URL(source)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isLikelyRepoSource(source: string): boolean {
  const normalized = source.trim()

  if (normalized.startsWith('git@')) {
    return true
  }

  if (isLikelyUrlSource(normalized)) {
    return /github\.com|gitlab\.com|bitbucket\.org/.test(new URL(normalized).hostname)
  }

  if (normalized.endsWith('.git') || /^[\w.-]+\/[\w.-]+$/.test(normalized)) {
    return true
  }

  if (!existsSync(normalized)) {
    return false
  }

  try {
    return statSync(normalized).isDirectory()
  } catch {
    return false
  }
}

export function classifySource(source: string): DiscoveredSourceKind {
  const normalized = source.trim()

  if (isLikelyUrlSource(normalized)) {
    return 'url'
  }

  if (isLikelyRepoSource(normalized)) {
    return 'repo'
  }

  const extension = path.extname(normalized).toLowerCase()

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'md'
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'txt'
  }

  return 'unknown'
}

export function isSupportedSourceKind(kind: string): kind is SourceKind {
  return SOURCE_KINDS.includes(kind as SourceKind)
}
