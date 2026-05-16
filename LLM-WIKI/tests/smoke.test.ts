import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli'

const execFile = promisify(execFileCallback)

describe('buildCli', () => {
  it('registers the MVP commands', () => {
    const cli = buildCli()
    expect(cli.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(['init', 'ingest', 'ingest-inbox', 'query', 'lint', 'status', 'save-synthesis'])
    )
  })

  it('ships a generic skill contract that delegates to the CLI surface', async () => {
    const skill = await readFile(path.join(process.cwd(), 'skills', 'llm-wiki', 'SKILL.md'), 'utf8')

    expect(skill).toContain('name: llm-wiki')
    expect(skill).toContain('operate an LLM-WIKI knowledge root through the repo CLI')
    expect(skill).toContain('npm run --silent cli -- ingest')
    expect(skill).toContain('Classification principles')
    expect(skill).toContain('Do not skip the approval step for review-gated operations')
    expect(skill).toContain('High confidence is not approval')
    expect(skill).not.toMatch(/WIKI_PATH|web_extract|read_file/)
  })

  it('supports the documented terminal handoff through npm run --silent cli', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-cli-smoke-'))

    try {
      const { stdout } = await execFile('npm', ['run', '--silent', 'cli', '--', 'init', knowledgeRoot], {
        cwd: process.cwd(),
      })

      const parsed = JSON.parse(stdout.trim()) as { knowledgeRoot: string; createdDirectories: string[] }
      expect(parsed.knowledgeRoot).toBe(path.resolve(knowledgeRoot))
      expect(parsed.createdDirectories).toContain('wiki/sources')

      const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
        bin?: Record<string, string>
      }
      const readme = await readFile(path.join(process.cwd(), 'README.md'), 'utf8')
      expect(packageJson.scripts?.cli).toBeTruthy()
      expect(packageJson.bin?.['llm-wiki']).toBe('dist/src/cli.js')
      expect(readme).toContain('npm run --silent cli --')
      expect(readme).not.toContain('npm run cli -- <')
    } finally {
      await rm(knowledgeRoot, { recursive: true, force: true })
    }
  }, 120000)
})
