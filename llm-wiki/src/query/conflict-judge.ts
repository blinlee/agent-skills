import type {
  QueryCitation,
  QueryConflictEvidence,
  QueryConflictSignal,
  QueryContradictionTableEntry,
} from './query.js'

export type EvidenceConflictJudge = {
  findSignals(citations: QueryCitation[]): QueryConflictSignal[]
}

type ConflictPattern = {
  pattern: RegExp
  kind: QueryConflictSignal['kind']
  severity: QueryConflictSignal['severity']
  reason: string
}

export class HeuristicEvidenceConflictJudge implements EvidenceConflictJudge {
  private readonly patterns: ConflictPattern[] = [
    { pattern: /\b(contradictory|contradicts|contradiction)\b|矛盾/i, kind: 'contradictory', severity: 'high', reason: 'heuristic:contradictory-evidence' },
    { pattern: /\b(conflict|inconsistent)\b|冲突|不一致/i, kind: 'conflict', severity: 'high', reason: 'heuristic:conflict-or-inconsistent-evidence' },
    { pattern: /\b(deprecated|outdated|stale|obsolete)\b|过时|废弃/i, kind: 'stale', severity: 'medium', reason: 'heuristic:stale-or-deprecated-evidence' },
    { pattern: /\b(uncertain|unknown|low confidence|ambiguous)\b|不确定|未知|低置信|歧义/i, kind: 'uncertain', severity: 'low', reason: 'heuristic:uncertain-or-ambiguous-evidence' },
  ]

  findSignals(citations: QueryCitation[]): QueryConflictSignal[] {
    const signals: QueryConflictSignal[] = []

    citations.forEach((citation, index) => {
      const matched = this.patterns
        .map((entry) => ({ entry, match: citation.excerpt.match(entry.pattern) }))
        .find(({ match }) => match)
      if (!matched?.match) return
      const selfEvidence = conflictEvidence(citation, index, matched.match[0])
      const pairedEvidence = nearestEvidencePair(citations, index)
      const evidence = [selfEvidence, pairedEvidence].filter((entry): entry is QueryConflictEvidence => entry !== null)
      signals.push({
        citationIndex: index + 1,
        target: citation.target,
        chunkId: citation.chunkId,
        kind: matched.entry.kind,
        severity: matched.entry.severity,
        reason: matched.entry.reason,
        matchedText: matched.match[0],
        excerpt: citation.excerpt,
        evidencePair: [selfEvidence, pairedEvidence],
        evidence,
        targets: [...new Set(evidence.map((entry) => entry.target))],
        chunkIds: [...new Set(evidence.map((entry) => entry.chunkId).filter((chunkId): chunkId is string => Boolean(chunkId)))],
      })
    })

    return signals
  }
}

export function buildContradictionTable(conflicts: QueryConflictSignal[]): QueryContradictionTableEntry[] {
  return conflicts
    .filter((signal) => signal.kind === 'conflict' || signal.kind === 'contradictory' || signal.kind === 'stale')
    .map((signal, index) => ({
      issueId: `contradiction-${index + 1}`,
      kind: signal.kind,
      severity: signal.severity,
      summary: contradictionSummary(signal),
      evidence: signal.evidence,
      targets: signal.targets,
      chunkIds: signal.chunkIds,
      freshness: signal.kind === 'stale' ? 'stale-signal' : signal.kind === 'uncertain' ? 'unknown' : 'current-conflict',
      recommendation: contradictionRecommendation(signal),
    }))
}

function conflictEvidence(citation: QueryCitation, index: number, matchedText?: string): QueryConflictEvidence {
  return {
    citationIndex: index + 1,
    target: citation.target,
    chunkId: citation.chunkId,
    excerpt: citation.excerpt,
    matchedText,
  }
}

function nearestEvidencePair(citations: QueryCitation[], index: number): QueryConflictEvidence | null {
  const neighborIndex = citations.findIndex((_, candidateIndex) => candidateIndex !== index)
  return neighborIndex >= 0 ? conflictEvidence(citations[neighborIndex]!, neighborIndex) : null
}

function contradictionSummary(signal: QueryConflictSignal): string {
  const evidence = signal.evidence.map((entry) => `#${entry.citationIndex}`).join(' vs ')
  if (signal.kind === 'stale') {
    return `${evidence} 包含过时/废弃信号，需要确认是否仍适用。`
  }
  if (signal.kind === 'contradictory') {
    return `${evidence} 明确出现矛盾信号，需要人工比较来源边界。`
  }
  return `${evidence} 出现冲突或不一致信号，需要人工确认采用哪条证据。`
}

function contradictionRecommendation(signal: QueryConflictSignal): string {
  if (signal.kind === 'stale') {
    return '优先找更新来源或维护者确认；确认后把旧页面标记为 contested/stale 或更新摘要。'
  }
  if (signal.kind === 'contradictory') {
    return '不要自动合并结论；先比较来源时间、适用范围和原始材料，再写入最终 wiki。'
  }
  return '把冲突双方保留为候选证据，补充边界条件或发起治理审核。'
}
