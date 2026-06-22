import { describe, expect, it } from 'vitest'
import { evidenceBudgetForChunkCount } from '../../src/retrieval/context-budget.js'

describe('dynamic evidence budget', () => {
  it('scales citation and context budgets by wiki chunk count', () => {
    expect(evidenceBudgetForChunkCount(0)).toEqual({ chunkCount: 0, citationLimit: 4, contextCharCap: 6000 })
    expect(evidenceBudgetForChunkCount(99)).toEqual({ chunkCount: 99, citationLimit: 4, contextCharCap: 6000 })
    expect(evidenceBudgetForChunkCount(100)).toEqual({ chunkCount: 100, citationLimit: 6, contextCharCap: 12000 })
    expect(evidenceBudgetForChunkCount(501)).toEqual({ chunkCount: 501, citationLimit: 8, contextCharCap: 20000 })
    expect(evidenceBudgetForChunkCount(2001)).toEqual({ chunkCount: 2001, citationLimit: 10, contextCharCap: 30000 })
    expect(evidenceBudgetForChunkCount(5001)).toEqual({ chunkCount: 5001, citationLimit: 12, contextCharCap: 40000 })
  })

  it('keeps explicit retrieval limits as a debug override', () => {
    expect(evidenceBudgetForChunkCount(5001, 2)).toEqual({ chunkCount: 5001, citationLimit: 2, contextCharCap: 40000 })
  })
})
