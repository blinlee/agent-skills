import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand, runQueryCommand, runLintCommand, runStatusCommand } from '../../src/cli.js'

const acceptanceRoot = '/tmp/llm-wiki-mvp-acceptance'

afterEach(async () => {
  await rm(acceptanceRoot, { recursive: true, force: true })
})

describe('mvp acceptance', () => {
  it('supports the approved MVP path end-to-end', async () => {
    const root = '/tmp/llm-wiki-mvp-acceptance'
    await runIngestCommand({ knowledgeRoot: root, input: 'tests/fixtures/inputs/sample.md' })
    await runIngestCommand({ knowledgeRoot: root, input: 'tests/fixtures/inputs/sample.txt' })

    const status = await runStatusCommand({ knowledgeRoot: root })
    const lint = await runLintCommand({ knowledgeRoot: root })
    const answer = await runQueryCommand({ knowledgeRoot: root, question: 'Summarize what has been ingested.' })

    const successfulJobs = (status.jobCountsByState.completed ?? 0) + (status.jobCountsByState.partial ?? 0) + (status.jobCountsByState.needs_review ?? 0)
    expect(successfulJobs).toBeGreaterThanOrEqual(2)
    expect(status.jobCounts.completed).toBe(status.jobCountsByState.completed)
    expect(lint.status).toBe('ok')
    expect(answer.citations.length).toBeGreaterThan(0)
  })
})
