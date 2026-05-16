import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  root,
  readIndexes,
  labelOf,
  extractAsciiTokens,
  containsPhrase,
  cleanLine,
  extractNegativeBullets,
  buildPromptMaps,
  rankPromptVariants,
  rankCasesForQuery,
  scoreTemplateTarget,
} from './prompt-bridge-utils.mjs';
import {
  loadPromptEngine,
  profileForTemplate,
  rankFragments,
  principlesForFamily,
  buildTextInspection,
  buildSlotClarifications,
  detectPlatform,
  detectRatio,
} from './prompt-compose-utils.mjs';

function printHelp() {
  console.log(`Usage:
  node scripts/template-brief.mjs --target references/ui-mockups/live-commerce-ui.md
  node scripts/template-brief.mjs --template-id ui-screenshot-system --query "live commerce ui"
  node scripts/template-brief.mjs --template-id ui-screenshot-system --pick 2

Options:
  --target <path>         Canonical template path to inspect
  --template-id <id>      Template id; resolve via canonical targets
  --query <text>          Query-aware target landing when template-id maps to many targets
  --queryfile <path>      Load query text from a file
  --pick <n>              When using --template-id, choose nth canonical target explicitly (1-based)
  --json                  Print structured JSON output
  -h, --help              Show help`);
}

function parseArgs(argv) {
  const cfg = { target: null, templateId: null, query: null, queryFile: null, pick: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--target') cfg.target = argv[++i] || null;
    else if (arg === '--template-id') cfg.templateId = argv[++i] || null;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else if (arg === '--pick') cfg.pick = Number.parseInt(argv[++i] || '1', 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function readQuery(query, queryFile) {
  if (query) return query.trim();
  if (queryFile) return (await readFile(path.resolve(queryFile), 'utf8')).trim();
  return null;
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

function extractFirstSection(lines, headings) {
  for (const heading of headings) {
    const section = extractSection(lines, heading);
    if (section.length) return section;
  }
  return [];
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

function extractBulletsAfterLabel(lines, label) {
  const start = lines.findIndex((line) => line.trim() === label);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) { if (out.length) break; else continue; }
    if (/^##\s+/.test(line)) break;
    if (/^[-*]\s+/.test(line)) out.push(cleanLine(line));
    else if (out.length) break;
  }
  return out;
}

function extractAvoidFromText(lines) {
  const markers = ['不要使用：', '不要使用:', '不要：', '避免：'];
  for (const marker of markers) {
    const start = lines.findIndex((line) => line.trim() === marker);
    if (start === -1) continue;
    const out = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) { if (out.length) break; else continue; }
      if (/^##\s+/.test(line)) break;
      if (/^[-*]\s+/.test(line)) out.push(cleanLine(line));
      else if (out.length) break;
    }
    if (out.length) return out;
  }
  return [];
}

function extractFirstJsonBlock(text) {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : null;
}

function extractAvoidFromJson(jsonBlock) {
  if (!jsonBlock) return [];
  try {
    const parsed = JSON.parse(jsonBlock);
    const avoid = parsed?.constraints?.avoid;
    return Array.isArray(avoid) ? avoid.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function summarizeMarkdown(text, target) {
  const lines = text.split(/\r?\n/);
  const title = (lines.find((line) => line.trim().startsWith('# ')) || '').replace(/^#\s*/, '').trim();
  const applicability = extractBullets(extractFirstSection(lines, ['## 适用范围']));
  const inlineApplicability = applicability.length ? applicability : extractBulletsAfterLabel(lines, '适用于：');
  const useWhenSection = extractFirstSection(lines, ['## 何时使用', '## 使用规则']);
  const useWhen = extractBullets(useWhenSection);
  const questionOrder = extractOrdered(extractSection(lines, '## 缺失信息优先提问顺序'));
  const avoidSection = extractFirstSection(lines, ['## 避免事项']);
  const avoid = extractBullets(avoidSection);
  const firstJsonTemplate = extractFirstJsonBlock(text);
  const hybridMeta = extractBullets(extractSection(lines, '## Hybrid retrieval metadata（Phase 1 pilot）'));
  return {
    target,
    title,
    applicability: inlineApplicability,
    useWhen,
    questionOrder,
    avoid: avoid.length ? avoid : (extractAvoidFromText(lines).length ? extractAvoidFromText(lines) : extractAvoidFromJson(firstJsonTemplate)),
    firstJsonTemplate,
    hybridMeta,
    negativeGuidance: extractNegativeBullets(text),
  };
}

async function resolveTarget(cfg, retrievalIndex) {
  if (cfg.target) return { target: cfg.target, templateRecord: null, rankedTargets: null, query: await readQuery(cfg.query, cfg.queryFile) };
  if (!cfg.templateId) throw new Error('Use --target or --template-id.');
  const found = (retrievalIndex.templates || []).find((item) => item.id === cfg.templateId);
  if (!found) throw new Error(`Template id not found: ${cfg.templateId}`);
  const targets = found.canonicalTargets || [];
  if (!targets.length) throw new Error(`No canonical targets for template id ${cfg.templateId}`);
  if (cfg.pick != null) {
    const pick = Math.max(1, cfg.pick) - 1;
    const target = targets[pick];
    if (!target) throw new Error(`No canonical targets[${pick + 1}] for template id ${cfg.templateId}`);
    return { target, templateRecord: found, rankedTargets: null, query: await readQuery(cfg.query, cfg.queryFile) };
  }
  const query = await readQuery(cfg.query, cfg.queryFile);
  if (!query && targets.length > 1) {
    throw new Error(`Template id ${cfg.templateId} has multiple canonical targets. Use --query/--queryfile for query-aware landing or pass --pick explicitly.`);
  }
  if (!query) return { target: targets[0], templateRecord: found, rankedTargets: null, query };
  const rankedTargets = targets.map((target) => ({ target, score: 0 }));
  return { target: targets[0], templateRecord: found, rankedTargets, query };
}

function rankTargetDocs(query, targets, templateDocs, routing) {
  return targets
    .map((target) => scoreTemplateTarget(query, target, templateDocs.get(target) || { title: '', snippet: '', text: '' }, routing))
    .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
}

function rankIntelligenceForTarget({ query, target, relatedTemplates, promptMaps }) {
  const queryTokens = new Set(extractAsciiTokens(query || ''));
  return relatedTemplates.map((template) => {
    let score = template.id === target ? 0 : 0;
    const promptIntelligence = promptMaps.promptByTemplateId.get(template.id) || null;
    const exactCases = promptMaps.exactCasesByTemplateId.get(template.id) || [];
    const candidateCases = promptMaps.candidateCasesByTemplateId.get(template.id) || [];
    const matchedOn = [];
    if (query) {
      for (const text of [template.id, labelOf(template.title), template.category, (template.tags || []).join(' ')]) {
        if (!text) continue;
        if (containsPhrase(query, text)) {
          score += 10;
          matchedOn.push({ reason: 'template-signal', value: text, points: 10 });
        }
      }
      for (const token of extractAsciiTokens(`${template.id} ${labelOf(template.title)} ${template.category} ${(template.tags || []).join(' ')}`)) {
        if (queryTokens.has(token)) {
          score += 2;
        }
      }
    }
    const selectedVariants = rankPromptVariants(query || '', promptIntelligence?.variants || [], 3);
    score += selectedVariants.reduce((sum, item) => sum + Math.min(item.score, 10), 0);
    const exact = rankCasesForQuery(query || '', exactCases, 3, { exact: true });
    const candidate = rankCasesForQuery(query || '', candidateCases, 2, { exact: false });
    score += exact.reduce((sum, item) => sum + Math.min(item.score, 10), 0);
    score += candidate.reduce((sum, item) => sum + Math.min(item.score, 4), 0);
    return {
      id: template.id,
      title: template.title,
      category: template.category,
      styles: template.styles || [],
      scenes: template.scenes || [],
      tags: template.tags || [],
      mappingConfidence: template.mappingConfidence,
      score,
      matchedOn,
      promptIntelligence: promptIntelligence ? {
        anchor: promptIntelligence.anchor,
        sectionTitle: promptIntelligence.sectionTitle,
        promptSource: promptIntelligence.promptSource,
        selectedVariants: selectedVariants.map((variant) => ({
          label: variant.label,
          format: variant.format,
          notes: variant.notes,
          prompt: variant.prompt,
          score: variant.score,
        })),
        pitfalls: promptIntelligence.pitfalls || [],
      } : null,
      supportingCases: {
        exact: exact.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          styles: item.styles,
          scenes: item.scenes,
          promptPreview: item.promptPreview,
          prompt: item.prompt,
          score: item.score,
        })),
        candidate: candidate.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          styles: item.styles,
          scenes: item.scenes,
          promptPreview: item.promptPreview,
          prompt: item.prompt,
          score: item.score,
          candidateScore: item.candidateScore || 0,
        })),
      },
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();

  const { retrievalIndex, promptIntelligenceIndex, promptCorpusIndex } = await readIndexes();
  const promptEngine = await loadPromptEngine();
  const { target, templateRecord, query } = await resolveTarget(cfg, retrievalIndex);
  const promptMaps = buildPromptMaps(promptIntelligenceIndex, promptCorpusIndex);
  const templateDocs = new Map();
  for (const t of new Set((retrievalIndex.templates || []).flatMap((item) => item.canonicalTargets || []).concat([target]))) {
    const text = await readFile(path.join(root, t), 'utf8');
    const lines = text.split(/\r?\n/);
    templateDocs.set(t, {
      title: (lines.find((line) => line.trim().startsWith('#')) || '').replace(/^#+\s*/, '').trim(),
      snippet: text.slice(0, 1800),
      text,
    });
  }

  const rankedTargets = templateRecord && query ? rankTargetDocs(query, templateRecord.canonicalTargets || [], templateDocs, promptEngine.routing) : null;
  const resolvedTarget = rankedTargets?.length ? rankedTargets[0].target : target;
  const text = await readFile(path.join(root, resolvedTarget), 'utf8');
  const result = summarizeMarkdown(text, resolvedTarget);
  const relatedTemplates = (retrievalIndex.templates || []).filter((item) => (item.canonicalTargets || []).includes(resolvedTarget));
  const rankedIntelligence = rankIntelligenceForTarget({
    query,
    target: templateRecord?.id || '',
    relatedTemplates: relatedTemplates.length ? relatedTemplates : (templateRecord ? [templateRecord] : []),
    promptMaps,
  });

  result.query = query;
  result.rankedTargets = rankedTargets;
  result.promptIntelligence = rankedIntelligence;
  result.primaryTemplateId = templateRecord?.id || rankedIntelligence[0]?.id || null;
  result.promptSources = {
    promptIntelligence: promptIntelligenceIndex.source,
    promptCorpus: promptCorpusIndex.source,
  };
  const engineProfile = profileForTemplate(result.primaryTemplateId, resolvedTarget, promptEngine.overlapMap);
  const engineFamilyMeta = (promptEngine.principles.families || []).find((item) => item.task_family === engineProfile.primaryTaskFamily) || null;
  result.promptEngine = {
    profile: engineProfile,
    fragments: rankFragments(query || '', result.primaryTemplateId, promptEngine.promptFragments, 3),
    principles: principlesForFamily(engineProfile.primaryTaskFamily, promptEngine.principles),
  };
  result.platform = detectPlatform(query || '');
  result.preferredOutputRatio = detectRatio(query || '', engineProfile.primaryTaskFamily, engineFamilyMeta?.default_aspect_ratios || []);
  result.textInspection = buildTextInspection(query || '', engineProfile.primaryTaskFamily);
  result.slotClarifications = buildSlotClarifications({
    query: query || '',
    family: engineProfile.primaryTaskFamily,
    clarifyRules: promptEngine.clarifyRules,
    brief: result,
    platform: result.platform,
    ratio: result.preferredOutputRatio,
  });

  if (cfg.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('# Template Brief\n');
  console.log(`Target: ${result.target}`);
  console.log(`Title: ${result.title}\n`);
  if (result.rankedTargets?.length) {
    console.log('## Ranked Canonical Targets');
    result.rankedTargets.forEach((item, idx) => console.log(`${idx + 1}. ${item.target} (score ${item.score})`));
    console.log('');
  }
  if (result.applicability.length) {
    console.log('## Applicability');
    result.applicability.forEach((item) => console.log(`- ${item}`));
    console.log('');
  }
  if (result.useWhen.length) {
    console.log('## Use When');
    result.useWhen.forEach((item) => console.log(`- ${item}`));
    console.log('');
  }
  if (result.questionOrder.length) {
    console.log('## Missing-Info Question Order');
    result.questionOrder.forEach((item, idx) => console.log(`${idx + 1}. ${item}`));
    console.log('');
  }
  if (result.promptIntelligence.length) {
    console.log('## Prompt Intelligence');
    result.promptIntelligence.forEach((template, idx) => {
      console.log(`${idx + 1}. ${template.id} (score ${template.score})`);
      if (template.promptIntelligence) {
        console.log(`   - section: ${template.promptIntelligence.sectionTitle}`);
        template.promptIntelligence.selectedVariants.forEach((variant) => console.log(`   - variant: ${variant.label} (score ${variant.score})`));
        template.promptIntelligence.pitfalls.slice(0, 6).forEach((item) => console.log(`   - pitfall: ${item}`));
      }
      template.supportingCases.exact.forEach((c) => console.log(`   - exact case ${c.id}: ${c.title} (score ${c.score})`));
      template.supportingCases.candidate.forEach((c) => console.log(`   - candidate case ${c.id}: ${c.title} (score ${c.score})`));
    });
    console.log('');
  }
  if (result.promptEngine.fragments.length) {
    console.log('## Prompt Fragments');
    result.promptEngine.fragments.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.title} (${item.taskFamily}, score ${item.score})`);
      (item.structuralHints || []).slice(0, 5).forEach((hint) => console.log(`   - ${hint}`));
    });
    console.log('');
  }
  if (result.slotClarifications?.needed) {
    console.log('## High-Impact Follow-up Questions');
    result.slotClarifications.questions.forEach((item, idx) => console.log(`${idx + 1}. ${item.question}`));
    console.log('');
  }
  if (result.textInspection?.textInspectionRequired) {
    console.log('## Text QA Gate');
    console.log(result.textInspection.deliveryRule);
    result.textInspection.inspectionZones.forEach((zone) => console.log(`- ${zone.label}: ${zone.reason}`));
    console.log('');
  }
  if (result.hybridMeta.length) {
    console.log('## Hybrid Retrieval Metadata');
    result.hybridMeta.forEach((item) => console.log(`- ${item}`));
    console.log('');
  }
  if (result.avoid.length) {
    console.log('## Avoid');
    result.avoid.forEach((item) => console.log(`- ${item}`));
    console.log('');
  }
  if (result.firstJsonTemplate) {
    console.log('## First JSON Template');
    console.log('```json');
    console.log(result.firstJsonTemplate);
    console.log('```');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
