import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const workflowsDir = path.join(root, 'references', 'editing-workflows');

function printHelp() {
  console.log(`Usage:
  node scripts/select-edit-workflow.mjs --query "keep the product, replace the background" [--top 3] [--json]

Options:
  --query <text>        Fuzzy edit request text
  --queryfile <path>    Load edit request text from a file
  --top <n>             Number of candidates to return (default: 3)
  --json                Print structured JSON output
  -h, --help            Show help`);
}

function parseArgs(argv) {
  const cfg = { query: null, queryFile: null, top: 3, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else if (arg === '--top') cfg.top = Number.parseInt(argv[++i] || '3', 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function readQuery(query, queryFile) {
  if (query) return query.trim();
  if (queryFile) return (await readFile(path.resolve(queryFile), 'utf8')).trim();
  throw new Error('Query is required. Use --query or --queryfile.');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

function containsPhrase(query, phrase) {
  const q = normalizeText(query);
  const p = normalizeText(phrase).trim();
  return p.length > 1 && q.includes(p);
}

function extractAsciiTokens(text) {
  return [...new Set((normalizeText(text).match(/[a-z0-9][a-z0-9+-]*/g) || []).flatMap((token) => token.split(/[+-]/g)).filter((token) => token.length >= 2))];
}

function cleanLine(line) {
  return line.replace(/^[-*]\s*/, '').trim();
}

function extractSection(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line) && line.trim() !== heading) break;
    out.push(line);
  }
  return out;
}

function extractSectionUntil(lines, heading, stopMarkers) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed) && trimmed !== heading) break;
    if (stopMarkers.some((marker) => trimmed === marker)) break;
    out.push(line);
  }
  return out;
}

function extractBullets(sectionLines) {
  return sectionLines
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map(cleanLine);
}

function extractOrdered(sectionLines) {
  return sectionLines
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());
}

function extractNegativeBullets(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || !line.includes('不要使用')) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next) {
        if (out.length) break;
        continue;
      }
      if (/^##\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next)) out.push(cleanLine(next));
      else if (out.length) break;
    }
  }
  return [...new Set(out.filter(Boolean))];
}

function extractFirstCodeBlock(text) {
  const match = text.match(/```(?:text|json)?\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

async function loadWorkflows() {
  const entries = await readdir(workflowsDir);
  const files = entries.filter((entry) => entry.endsWith('.md')).sort();
  const workflows = [];
  for (const file of files) {
    const rel = path.join('references', 'editing-workflows', file);
    const text = await readFile(path.join(workflowsDir, file), 'utf8');
    const lines = text.split(/\r?\n/);
    workflows.push({
      id: file.replace(/\.md$/, ''),
      target: rel,
      title: (lines.find((line) => line.trim().startsWith('# ')) || '').replace(/^#\s*/, '').trim(),
      applicability: extractBullets(extractSection(lines, '## 适用范围')),
      useWhen: extractBullets(extractSectionUntil(lines, '## 何时使用', ['不要使用：', '不要使用:'])),
      questionOrder: extractOrdered(extractSection(lines, '## 缺失信息优先提问顺序')),
      avoid: extractNegativeBullets(lines),
      firstTemplate: extractFirstCodeBlock(text),
      text,
    });
  }
  return workflows;
}

function scoreWorkflow(query, workflow) {
  const asciiTokens = new Set(extractAsciiTokens(query));
  const matchedOn = [];
  let score = 0;

  const add = (points, reason, value) => {
    score += points;
    matchedOn.push({ reason, value, points });
  };

  const matchText = (value, points, reason) => {
    if (value && containsPhrase(query, value)) add(points, reason, value);
  };

  const matchAsciiTokenOverlap = (value, pointsPerToken, reason) => {
    const overlaps = extractAsciiTokens(value).filter((token) => asciiTokens.has(token));
    if (overlaps.length) add(overlaps.length * pointsPerToken, reason, overlaps.join(', '));
  };

  matchText(workflow.title, 18, 'title');
  matchAsciiTokenOverlap(workflow.id, 8, 'workflow-id-token');

  for (const item of workflow.applicability) matchText(item, 14, 'applicability');
  for (const item of workflow.useWhen) matchText(item, 12, 'use-when');

  const keywordBank = [
    'background', 'replace background', 'background replacement', '换背景', '背景替换', '棚景', 'outdoor',
    'remove', 'removal', '去除', '删除', '杂物', '路人', 'watermark',
    'replace object', 'replacement', '替换', '换成', 'logo', 'shirt', 'hoodie',
    'portrait', 'hair', 'makeup', '人像', '发型', '发色', '服装', '妆容',
    'retouch', 'retouching', 'scratch', 'label', 'product retouch', '精修', '划痕', '标签'
  ];
  for (const piece of keywordBank) {
    if (containsPhrase(query, piece) && containsPhrase(workflow.text, piece)) add(8, 'keyword', piece);
  }

  const removeIntent = ['remove', 'delete', 'erase', '去除', '删除', '移除'].some((piece) => containsPhrase(query, piece));
  const replaceBackgroundIntent = ['replace the background', 'replace background', 'background replacement', '换背景', '背景替换'].some((piece) => containsPhrase(query, piece));
  const portraitIntent = ['hair', 'makeup', 'same person', 'same face', '人像', '发型', '发色', '妆容', '同一个人'].some((piece) => containsPhrase(query, piece));
  const retouchIntent = ['retouch', 'retouching', 'scratch', 'scratches', 'label', '精修', '划痕', '标签', '锐化'].some((piece) => containsPhrase(query, piece));
  const replaceObjectIntent = ['replace object', 'replace the shirt', 'replace the logo', '换成', '替换', 'logo', 'shirt', 'hoodie'].some((piece) => containsPhrase(query, piece));

  if (workflow.id === 'object-removal' && removeIntent) add(24, 'intent', 'remove/delete');
  if (workflow.id === 'background-replacement' && replaceBackgroundIntent) add(24, 'intent', 'replace background');
  if (workflow.id === 'portrait-local-edit' && portraitIntent) add(24, 'intent', 'portrait local edit');
  if (workflow.id === 'product-retouching' && retouchIntent) add(24, 'intent', 'product retouch');
  if (workflow.id === 'local-object-replacement' && replaceObjectIntent) add(24, 'intent', 'local object replacement');

  if (workflow.id === 'background-replacement' && removeIntent && !replaceBackgroundIntent) add(-16, 'intent-conflict', 'remove/delete is not background replacement');
  if (workflow.id === 'object-removal' && replaceBackgroundIntent) add(-12, 'intent-conflict', 'background replacement is not object removal');

  for (const avoid of workflow.avoid) {
    const avoidSignals = ['背景', '换背景', '替换', '去除', '删除', 'logo', '发型', '发色', '妆容', '精修', 'retouch', 'hair', 'background', 'remove'];
    for (const piece of avoidSignals) {
      if (containsPhrase(query, piece) && containsPhrase(avoid, piece)) add(-12, 'negative-guidance', avoid);
    }
  }

  return {
    workflowId: workflow.id,
    target: workflow.target,
    title: workflow.title,
    score,
    matchedOn,
    applicability: workflow.applicability,
    useWhen: workflow.useWhen,
    questionOrder: workflow.questionOrder,
    avoid: workflow.avoid,
    firstTemplate: workflow.firstTemplate,
  };
}

function rankWorkflows(query, workflows, topN) {
  return workflows
    .map((workflow) => scoreWorkflow(query, workflow))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.workflowId.localeCompare(b.workflowId))
    .slice(0, topN);
}

function printHuman(query, ranked) {
  console.log('# Edit Workflow Selection\n');
  console.log(`Query: ${query}\n`);
  if (!ranked.length) {
    console.log('No edit workflow matched strongly enough. Fall back to manual workflow selection.');
    return;
  }
  ranked.forEach((item, index) => {
    console.log(`## ${index + 1}. ${item.workflowId} (score ${item.score})`);
    console.log(`- Target: ${item.target}`);
    if (item.questionOrder.length) {
      console.log('- Missing-info question order:');
      item.questionOrder.forEach((q, idx) => console.log(`  ${idx + 1}. ${q}`));
    }
    console.log('- Matched on:');
    item.matchedOn.slice(0, 8).forEach((match) => console.log(`  - [${match.points}] ${match.reason}: ${match.value}`));
    console.log('');
  });
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    printHelp();
    return;
  }
  const query = await readQuery(cfg.query, cfg.queryFile);
  const workflows = await loadWorkflows();
  const ranked = rankWorkflows(query, workflows, Math.max(1, cfg.top || 3));
  const output = {
    query,
    selectionRule: 'edit-intent -> editing workflow -> missing-field questions -> edit prompt',
    candidates: ranked,
  };
  if (cfg.json) console.log(JSON.stringify(output, null, 2));
  else printHuman(query, ranked);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
