import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli'

const execFile = promisify(execFileCallback)
const pythonBin = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')

async function expectExecFileFailure(
  command: string,
  args: string[],
  options: Parameters<typeof execFile>[2]
): Promise<{ stdout: string; stderr: string }> {
  try {
    await execFile(command, args, options)
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
  throw new Error(`Expected command to fail: ${command} ${args.join(' ')}`)
}

describe('buildCli', () => {
  it('registers the MVP commands', () => {
    const cli = buildCli()
    expect(cli.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(['init', 'ingest', 'ingest-inbox', 'query', 'lint', 'status', 'save-synthesis'])
    )
  })

  it('ships a generic skill contract that delegates to the CLI surface', async () => {
    const skill = await readFile(path.join(process.cwd(), 'SKILL.md'), 'utf8')

    expect(skill).toContain('name: llm-wiki')
    expect(skill).toContain('operate an llm-wiki knowledge root through the repo CLI')
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

  it('requires an existing host-local root when resolving the skill default strictly', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-root-config-'))
    const configPath = path.join(workspace, 'config.json')
    const root = path.join(workspace, 'knowledge')
    const missingRoot = path.join(workspace, 'missing-root')
    const env = { ...process.env, llm_wiki_config: configPath, llm_wiki_root: '' }

    try {
      await mkdir(root)
      const resolvedRoot = await realpath(root)

      await execFile(pythonBin, ['scripts/root_config.py', 'set', root, '--kind', 'knowledge'], {
        cwd: process.cwd(),
        env,
      })

      const { stdout } = await execFile(
        pythonBin,
        ['scripts/root_config.py', 'show', '--strict', '--require-existing'],
        { cwd: process.cwd(), env }
      )
      const resolved = JSON.parse(stdout.trim()) as { status: string; root: string; exists: boolean; kind: string }
      expect(resolved.status).toBe('found')
      expect(resolved.root).toBe(resolvedRoot)
      expect(resolved.exists).toBe(true)
      expect(resolved.kind).toBe('knowledge')

      const { stdout: missingStdout } = await expectExecFileFailure(
        pythonBin,
        ['scripts/root_config.py', 'show', '--strict', '--require-existing'],
        {
          cwd: process.cwd(),
          env: { ...env, llm_wiki_root: missingRoot },
        }
      )
      const missing = JSON.parse(missingStdout.trim()) as { status: string; error: string; exists: boolean }
      expect(missing.status).toBe('missing_path')
      expect(missing.error).toBe('resolved_root_does_not_exist')
      expect(missing.exists).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('discovers required upstream skills through the portable skill discovery helper', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-skill-discovery-'))
    const skillsRoot = path.join(workspace, 'skills')
    const anything2mdRoot = path.join(skillsRoot, 'anything2md')
    const env = {
      ...process.env,
      AGENTS_SKILLS_DIR: skillsRoot,
      OPENCLAW_SKILLS_DIR: '',
      CODEX_HOME: '',
    }

    try {
      await mkdir(anything2mdRoot, { recursive: true })
      await writeFile(path.join(anything2mdRoot, 'SKILL.md'), '---\nname: anything2md\n---\n', 'utf8')

      const { stdout } = await execFile(pythonBin, ['scripts/skill_discovery.py', 'anything2md', '--json'], {
        cwd: process.cwd(),
        env,
      })
      const discovered = JSON.parse(stdout.trim()) as { status: string; skillRoot: string; skillFile: string }
      expect(discovered.status).toBe('found')
      expect(discovered.skillRoot).toBe(anything2mdRoot)
      expect(discovered.skillFile).toBe(path.join(anything2mdRoot, 'SKILL.md'))

      const { stdout: missingStdout } = await expectExecFileFailure(
        pythonBin,
        ['scripts/skill_discovery.py', 'definitely-missing-llm-wiki-test-skill', '--json'],
        { cwd: process.cwd(), env }
      )
      const missing = JSON.parse(missingStdout.trim()) as { status: string; matches: unknown[] }
      expect(missing.status).toBe('missing')
      expect(missing.matches).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
