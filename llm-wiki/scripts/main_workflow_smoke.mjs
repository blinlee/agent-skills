#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(os.tmpdir(), `llm-wiki-main-workflow-smoke-${Date.now()}.json`)

if (!outputPath) {
  throw new Error('missing value after --output')
}

const emptyConfig = path.join(os.tmpdir(), `llm-wiki-empty-config-${Date.now()}.json`)
writeFileSync(emptyConfig, JSON.stringify({}), 'utf8')
const env = { ...process.env, llm_wiki_config: emptyConfig }

function cli(args, options = {}) {
  const started = Date.now()
  try {
    const stdout = execFileSync('npm', ['run', '--silent', 'cli', '--', ...args], {
      cwd: packageRoot,
      env,
      encoding: 'utf8',
      timeout: options.timeout ?? 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, ms: Date.now() - started, json: JSON.parse(stdout), stdout }
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      status: error.status,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? String(error),
    }
  }
}

function summarize(value) {
  if (!value || typeof value !== 'object') return value
  const keep = {}
  for (const key of [
    'knowledgeRoot',
    'registryRoot',
    'status',
    'wikis',
    'wiki',
    'proposal',
    'results',
    'scan',
    'pendingCount',
    'action',
    'decision',
    'index',
    'okfDirectoryIndexes',
    'readiness',
    'sourceReadingPack',
    'answerability',
    'linkCount',
    'unresolvedCount',
    'pendingCount',
    'proposals',
    'files',
  ]) {
    if (key in value) keep[key] = value[key]
  }
  return keep
}

function writeCurationPlan(sourcePath, input = {}) {
  const title = input.title ?? path.basename(sourcePath)
  const quote = input.quote
  if (!quote) {
    throw new Error(`curation quote is required for ${sourcePath}`)
  }
  const curationPath = input.curationPath ?? `${sourcePath}.curation.json`
  writeFileSync(curationPath, JSON.stringify({
    schema: 'llm-wiki.semantic-curation.v1',
    status: 'ready',
    summary: input.summary ?? `测试语义整理：${title} 已读完，可以入库并生成可浏览知识页。`,
    entities: input.entities ?? [],
    concepts: input.concepts ?? [],
    syntheses: input.syntheses ?? [],
    notes: input.notes ?? [`测试 curation plan 使用原文证据：${quote}`],
  }, null, 2), 'utf8')
  return curationPath
}

function writeQualityPlan(sourcePath, input = {}) {
  const title = input.title ?? path.basename(sourcePath)
  const quote = input.quote
  if (!quote) {
    throw new Error(`quality quote is required for ${sourcePath}`)
  }
  const qualityPath = input.qualityPath ?? `${sourcePath}.quality.json`
  writeFileSync(qualityPath, JSON.stringify({
    schema: 'llm-wiki.inbox-quality.v1',
    status: 'ready',
    decision: 'accept',
    recommendedAction: 'accept',
    knowledgeValue: input.knowledgeValue ?? 'medium',
    readability: 'readable',
    duplicateAssessment: {
      status: 'new',
      matchedRefs: [],
    },
    sourceType: input.sourceType ?? 'note',
    reason: input.reason ?? `测试质量判断：${title} 有稳定知识价值，可进入 wiki。`,
    evidence: [{ quote }],
    blockers: [],
  }, null, 2), 'utf8')
  return qualityPath
}

function record(results, workflow, step, output, check, assertion) {
  const assertionResult = output.ok && assertion ? assertion(output.json) : { ok: output.ok, message: output.ok ? 'command ok' : 'command failed' }
  results.push({
    workflow,
    step,
    ok: output.ok && assertionResult.ok,
    ms: output.ms,
    check,
    assertion: assertionResult.message,
    output: output.ok ? summarize(output.json) : {
      status: output.status,
      stderr: output.stderr?.slice(0, 1000),
      stdout: output.stdout?.slice(0, 1000),
    },
  })
}

const results = []
const base = mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-main-workflows-'))
const wikiRoot = path.join(base, 'wiki')
const registryRoot = path.join(base, 'atlas')
const sourceDir = path.join(base, 'sources')
await mkdir(sourceDir, { recursive: true })

record(results, 'setup', 'init single wiki', cli(['init', wikiRoot]), 'creates a wiki layout')
record(results, 'setup', 'status single wiki', cli(['status', wikiRoot]), 'reports required paths')
record(results, 'setup', 'registry init', cli(['registry-init', registryRoot]), 'creates atlas registry')
record(results, 'setup', 'registry list empty', cli(['registry-list', registryRoot]), 'returns an empty wiki list')
record(results, 'setup', 'registry add agent', cli(['registry-add', registryRoot, '--id', 'agent', '--title', 'Agent Wiki', '--scope', 'agent,harness,tool calling']), 'creates wikis/agent')
record(results, 'setup', 'registry add finance', cli(['registry-add', registryRoot, '--id', 'finance', '--title', 'Finance Wiki', '--scope', 'finance,alpha,factor,trading']), 'creates wikis/finance')

await mkdir(path.join(registryRoot, 'raw', 'inbox'), { recursive: true })
const agentSource = path.join(registryRoot, 'raw', 'inbox', 'agent-harness.md')
writeFileSync(
  agentSource,
  '# Agent Harness Note\n\nAgent harness design uses tool calling, evaluation, and long-running supervision for coding agents.\n',
  'utf8',
)
const agentCuration = writeCurationPlan(agentSource, {
  title: 'Agent Harness Note',
  quote: 'Agent harness design uses tool calling, evaluation, and long-running supervision for coding agents.',
  entities: [{
    title: 'Agent Harness',
    slug: 'agent-harness',
    kind: 'system',
    description: 'Agent Harness 是用于组织工具调用、评测和长程监督的编码 agent 运行框架。',
    evidence: [{ quote: 'Agent harness design uses tool calling, evaluation, and long-running supervision for coding agents.' }],
  }],
  concepts: [{
    title: 'Long-running Supervision',
    slug: 'long-running-supervision',
    description: 'Long-running Supervision 指对长时间运行的 agent 任务进行持续观察和控制。',
    evidence: [{ quote: 'long-running supervision for coding agents' }],
  }],
})
writeQualityPlan(agentSource, {
  title: 'Agent Harness Note',
  quote: 'Agent harness design uses tool calling, evaluation, and long-running supervision for coding agents.',
})
record(results, 'inbox', 'intake scan', cli(['intake-scan', registryRoot]), 'moves raw/inbox item to raw/objects and ledger')
record(results, 'inbox', 'route inbox', cli(['route-inbox', registryRoot]), 'creates route proposal without ingesting')
const routeInbox = results.at(-1).output
const proposalId = routeInbox?.results?.[0]?.proposal?.id
if (proposalId) {
  record(results, 'inbox', 'route accept', cli(['route-accept', registryRoot, proposalId, '--reviewer', 'smoke']), 'ingests target wiki and rebuilds index')
} else {
  results.push({ workflow: 'inbox', step: 'route accept', ok: false, check: 'proposal id should exist', assertion: 'missing proposal id', output: routeInbox })
}
record(
  results,
  'inbox',
  'intake status after route accept',
  cli(['intake-status', registryRoot]),
  'accepted item does not remain pending',
  (json) => ({ ok: json.pendingCount === 0, message: `pendingCount=${json.pendingCount}` }),
)

record(
  results,
  'query',
  'query-registry accepted source',
  cli(['query-registry', registryRoot, 'agent harness design 怎么做？']),
  'returns sourceReadingPack passages from accepted material',
  (json) => ({ ok: (json.sourceReadingPack?.passages?.length ?? 0) > 0, message: `passages=${json.sourceReadingPack?.passages?.length ?? 0}` }),
)

record(results, 'maintain', 'maintain single wiki', cli(['maintain', path.join(registryRoot, 'wikis', 'agent')]), 'refreshes one wiki')
record(results, 'maintain', 'lint single wiki after maintain', cli(['lint', path.join(registryRoot, 'wikis', 'agent')]), 'stays lintable after maintain')
record(
  results,
  'maintain',
  'maintain registry root',
  cli(['maintain', registryRoot]),
  'maintains registered wikis from registry root',
  (json) => ({ ok: json.kind === 'registry' && json.status === 'ready', message: `kind=${json.kind}; status=${json.status}` }),
)
record(results, 'maintain', 'query-readiness registry root', cli(['query-readiness', registryRoot]), 'reports registry query readiness')

const profileSource = path.join(sourceDir, 'robot-perception.md')
writeFileSync(profileSource, '# Robot Perception Notes\n\nRobot perception uses multimodal sensors, embodied evaluation, and spatial scene understanding.\n', 'utf8')
const profile = cli(['profile-suggest', registryRoot, '--source', profileSource, '--id', 'robot-perception', '--title', 'Robot Perception'])
record(results, 'govern', 'profile suggest', profile, 'creates evidence-backed profile proposal')
const profileId = profile.ok ? profile.json.proposal?.id : null
if (profileId) {
  record(results, 'govern', 'profile accept', cli(['profile-accept', registryRoot, profileId, '--reviewer', 'smoke']), 'accepts profile and creates wiki boundary')
}
record(results, 'govern', 'profile review', cli(['profile-review', registryRoot]), 'reviews profile state')

const crossSource = path.join(sourceDir, 'pinn.md')
writeFileSync(crossSource, '# Physics-Informed Neural Networks\n\nPINN methods train neural networks with PDE residual losses for physics simulation and differential equations.\n', 'utf8')
const crossCuration = writeCurationPlan(crossSource, {
  title: 'Physics-Informed Neural Networks',
  quote: 'PINN methods train neural networks with PDE residual losses for physics simulation and differential equations.',
  entities: [{
    title: 'Physics-Informed Neural Networks',
    slug: 'physics-informed-neural-networks',
    kind: 'method',
    description: 'Physics-Informed Neural Networks 是把 PDE 残差损失纳入神经网络训练的物理仿真方法。',
    evidence: [{ quote: 'PINN methods train neural networks with PDE residual losses for physics simulation and differential equations.' }],
  }],
  concepts: [{
    title: 'PDE Residual Loss',
    slug: 'pde-residual-loss',
    description: 'PDE Residual Loss 是用微分方程残差约束模型训练的损失项。',
    evidence: [{ quote: 'PDE residual losses' }],
  }],
})
const crossQuality = writeQualityPlan(crossSource, {
  title: 'Physics-Informed Neural Networks',
  quote: 'PINN methods train neural networks with PDE residual losses for physics simulation and differential equations.',
})
record(results, 'govern', 'registry add physics', cli(['registry-add', registryRoot, '--id', 'physics', '--title', 'Physics Wiki', '--scope', 'physics,pde,differential equations,pinn']), 'prepares bridge target')
const routeCross = cli(['route', registryRoot, crossSource])
record(results, 'govern', 'route cross-domain source', routeCross, 'creates reviewable classification package')
const crossProposal = routeCross.ok ? routeCross.json.proposal?.id : null
if (crossProposal) {
  record(results, 'govern', 'accept cross-domain route', cli(['route-accept', registryRoot, crossProposal, '--reviewer', 'smoke', '--quality', crossQuality, '--curation', crossCuration]), 'accepts cross-domain route after approval simulation')
}
record(results, 'govern', 'bridge list', cli(['bridge-list', registryRoot]), 'lists bridge proposals/state')
record(results, 'govern', 'bridge index', cli(['bridge-index', registryRoot]), 'indexes explicit cross-wiki links')
record(results, 'govern', 'taxonomy list agent wiki', cli(['taxonomy-list', path.join(registryRoot, 'wikis', 'agent')]), 'exposes taxonomy proposal surface')

const summary = {
  generatedAt: new Date().toISOString(),
  packageRoot,
  base,
  config: emptyConfig,
  pass: results.filter((result) => result.ok).length,
  fail: results.filter((result) => !result.ok).length,
  results,
}
writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8')

for (const result of results) {
  console.log(JSON.stringify({
    workflow: result.workflow,
    step: result.step,
    ok: result.ok,
    ms: result.ms,
    assertion: result.assertion,
    error: result.output?.stderr,
  }))
}

if (summary.fail > 0) {
  console.error(`main workflow smoke failed: ${summary.fail} failing step(s); report: ${outputPath}`)
  process.exit(1)
}

console.error(`main workflow smoke passed: ${summary.pass} step(s); report: ${outputPath}`)
