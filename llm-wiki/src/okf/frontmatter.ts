export type ParsedMarkdownWithFrontmatter = {
  frontmatter: Record<string, unknown>
  body: string
}

export function parseMarkdownWithFrontmatter(content: string): ParsedMarkdownWithFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content)
  if (!match) {
    return { frontmatter: {}, body: content }
  }
  return {
    frontmatter: parseYamlFrontmatter(match[1] ?? ''),
    body: match[2] ?? '',
  }
}

export function parseYamlFrontmatter(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? ''
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line)
    if (!match) continue

    const key = match[1]!
    const raw = match[2] ?? ''
    if (raw.length > 0) {
      result[key] = parseYamlScalarOrInlineArray(raw)
      continue
    }

    const items: unknown[] = []
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? ''
      const itemMatch = /^\s*-\s*(.*)$/.exec(next)
      if (!itemMatch) break
      items.push(parseYamlScalarOrInlineArray(itemMatch[1] ?? ''))
      index += 1
    }
    result[key] = items
  }
  return result
}

export function formatYamlFrontmatter(fields: Record<string, unknown>): string {
  return [
    '---',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${formatYamlValue(value)}`),
    '---',
    '',
  ].join('\n')
}

function parseYamlScalarOrInlineArray(value: string): unknown {
  const raw = value.trim()
  if (!raw) return ''
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null' || raw === '~') return null
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseInlineArray(raw)
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

function parseInlineArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    const body = raw.slice(1, -1).trim()
    if (!body) return []
    return body.split(',').map((item) => parseYamlScalarOrInlineArray(item.trim()))
  }
}

function formatYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => JSON.stringify(String(item))).join(', ')}]`
  }
  return JSON.stringify(value ?? '')
}
