import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonFile } from '../shared/fs.js'
import { appendWikiLog } from '../wiki/index-log.js'
import type { QueryCitation, QueryGroundingDiagnostics, QuerySynthesisSuggestion, StoredSynthesisSuggestion } from './query.js'
import type { IndexedPage } from '../wiki/links.js'

export async function persistSynthesisSuggestion(input: {
  knowledgeRoot: string
  question: string
  answer: string
  citations: QueryCitation[]
  grounding: QueryGroundingDiagnostics
  primaryPage: IndexedPage
}): Promise<QuerySynthesisSuggestion> {
  const id = `synthesis-${randomUUID()}`
  const createdAt = new Date().toISOString()
  const title = `${input.primaryPage.title} synthesis suggestion`
  const slug = buildSuggestionSlug(input.primaryPage.slug, id)
  const filePath = path.join(input.knowledgeRoot, 'review', 'queue', `${id}.json`)
  const mergeCandidatePath = path.join(input.knowledgeRoot, 'review', 'merge-candidates', `${id}.json`)
  const markdown = buildSuggestionMarkdown({
    title,
    question: input.question,
    answer: input.answer,
    citations: input.citations,
    grounding: input.grounding,
    suggestionId: id,
    createdAt,
  })

  const record: StoredSynthesisSuggestion = {
    id,
    type: 'synthesis-suggestion',
    status: 'suggested',
    question: input.question,
    title,
    slug,
    answer: input.answer,
    citations: input.citations,
    relatedPages: input.citations.map((citation) => citation.target),
    grounding: input.grounding,
    markdown,
    createdAt,
    updatedAt: createdAt,
  }

  await Promise.all([
    writeJsonFile(filePath, record),
    writeJsonFile(mergeCandidatePath, record),
  ])

  return {
    id,
    status: record.status,
    slug,
    title,
    filePath,
  }
}

function buildSuggestionSlug(primarySlug: string, suggestionId: string): string {
  const uniqueSuffix = suggestionId.replace(/^synthesis-/, '')
  return `${primarySlug}-query-synthesis-${uniqueSuffix}`
}


function formatGroundedClaims(grounding: QueryGroundingDiagnostics): string[] {
  return grounding.claims.length > 0
    ? grounding.claims.map((claim) => `- ${claim.text} [${claim.supportingCitations.join(', ')}] confidence=${claim.confidence} support=${claim.supportLevel} coverage=${claim.citationCoverage} matched=${claim.matchedTerms.join(', ') || 'none'} reason=${claim.reason}`)
    : ['- No claim-level citations captured.']
}

function formatConflictSignals(grounding: QueryGroundingDiagnostics): string[] {
  return grounding.conflicts.length > 0
    ? [
        '| Kind | Severity | Reason | Evidence pair | Targets | Chunk IDs |',
        '|---|---|---|---|---|---|',
        ...grounding.conflicts.map((signal) => `| ${signal.kind} | ${signal.severity} | ${signal.reason} | ${signal.evidence.map((entry) => `${entry.citationIndex}:${entry.matchedText ?? 'excerpt'}`).join('<br>')} | ${signal.targets.join('<br>')} | ${signal.chunkIds.join('<br>')} |`),
      ]
    : ['- No conflict signals detected.']
}

function formatContradictionTable(grounding: QueryGroundingDiagnostics): string[] {
  return grounding.contradictionTable.length > 0
    ? [
        '| Issue | Severity | Summary | Recommendation | Evidence |',
        '|---|---|---|---|---|',
        ...grounding.contradictionTable.map((entry) => `| ${entry.issueId} | ${entry.severity} | ${entry.summary} | ${entry.recommendation} | ${entry.evidence.map((item) => `#${item.citationIndex} ${item.target}`).join('<br>')} |`),
      ]
    : ['- No structured contradiction table entries.']
}

function buildSuggestionMarkdown(input: {
  title: string
  question: string
  answer: string
  citations: QueryCitation[]
  grounding: QueryGroundingDiagnostics
  suggestionId: string
  createdAt: string
}): string {
  const citationLines = input.citations.length > 0
    ? input.citations.map((citation) => {
        const span = citation.startLine && citation.endLine ? `:${citation.startLine}-${citation.endLine}` : ''
        const heading = citation.heading ? ` / ${citation.heading}` : ''
        return `- [[${citation.target}|${citation.title}]]${heading}${span} — ${citation.excerpt}`
      })
    : ['- 未捕获到支撑引用。']

  return [
    `# ${input.title}`,
    '',
    `- 建议 ID: ${input.suggestionId}`,
    `- 创建时间: ${input.createdAt}`,
    '',
    '## 问题',
    input.question,
    '',
    '## 综合回答',
    input.answer,
    '',
    '## 证据约束',
    `- Answerability: ${input.grounding.answerability}`,
    `- Evidence budget: ${input.grounding.evidenceBudget}`,
    `- Selected citations: ${input.grounding.selectedCitationCount}`,
    `- Potential conflicts: ${input.grounding.conflictCount}`,
    '',
    '## Claim-level citations',
    ...formatGroundedClaims(input.grounding),
    '',
    '## Conflict signals',
    ...formatConflictSignals(input.grounding),
    '',
    '## Structured contradiction table',
    ...formatContradictionTable(input.grounding),
    '',
    '## 引用',
    ...citationLines,
  ].join('\n').trimEnd() + '\n'
}
