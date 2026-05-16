export const SOURCE_KINDS = ['md', 'txt', 'url', 'repo'] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'needs_review'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'rejected'
  | 'cancelled'

export type NormalizedArtifact = {
  id: string
  sourceKind: SourceKind
  sourceRef: string
  title: string
  content: string
  summary: string
  tags: string[]
  metadata: Record<string, string | number | boolean | null>
  createdAt: string
  updatedAt: string
}

export type CompileAnalysis = {
  artifactId: string
  language: string
  topics: string[]
  entities: string[]
  confidence: number
  notes: string[]
}

export type CompileGenerationResult = {
  artifactId: string
  outputPath: string
  checksum: string
  warnings: string[]
  generatedAt: string
}

export type ReviewItem = {
  id: string
  artifactId: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  reviewer: string | null
  createdAt: string
  updatedAt: string
}

export type TopicProposal = {
  id: string
  slug: string
  title: string
  description: string
  relatedArtifactIds: string[]
  rationale: string
  createdAt: string
}
