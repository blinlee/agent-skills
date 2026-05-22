import process from 'node:process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadPromptEngine,
  profileForTemplate,
  principlesForFamily,
  detectPlatform,
  detectRatio,
  buildTextInspection,
  buildSlotClarifications,
  buildReferenceRebuild,
  composePromptDraft,
  buildRenderContract,
  inferFamilyFromTarget,
} from './prompt-compose-utils.mjs';
import { composeTemplatesForQuery } from './compose-templates.mjs';
import { loadRoutingBrief } from './routing-brief.mjs';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function printHelp() {
  console.log(`Usage:
  node scripts/build-prompt.mjs --query "make a live commerce UI mockup" [--json]
  node scripts/build-prompt.mjs --template-id ui-screenshot-system --query "live commerce ui" [--json]
  node scripts/build-prompt.mjs --reference-image-summary "short visual summary" --reference-user-intent "recreate it but swap the product" [--json]

Options:
  --query <text>                    User request
  --queryfile <path>                Load request text from a file
  --template-id <id>                Use selector/template hub directly
  --target <path>                   Use an explicit canonical template target directly
  --pick <n>                        Explicit canonical target index for --template-id
  --selector-debug                  Force selector path for debugging
  --reference-image <path>          Local reference-image path for traceability
  --reference-image-summary <text>  Visual summary produced by the multimodal controller after inspecting the image
  --reference-user-intent <text>    Requested changes or extra intent in reference-image mode
  --reference-keep <text>           Explicit keep note in reference-image mode
  --reference-change <text>         Explicit change note in reference-image mode
  --routing-brief <json>            Precomputed routing brief JSON
  --routing-brief-file <path>       Load routing brief JSON from a file
  --json                            Print structured JSON output
  -h, --help                        Show help`);
}

function parseArgs(argv) {
  const cfg = {
    query: null,
    queryFile: null,
    templateId: null,
    target: null,
    pick: null,
    selectorDebug: false,
    referenceImage: null,
    referenceImageSummary: null,
    referenceUserIntent: '',
    referenceKeep: '',
    referenceChange: '',
    routingBrief: null,
    routingBriefFile: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else if (arg === '--template-id') cfg.templateId = argv[++i] || null;
    else if (arg === '--target') cfg.target = argv[++i] || null;
    else if (arg === '--pick') cfg.pick = Number(argv[++i] || 0) || null;
    else if (arg === '--selector-debug') cfg.selectorDebug = true;
    else if (arg === '--reference-image') cfg.referenceImage = argv[++i] || null;
    else if (arg === '--reference-image-summary') cfg.referenceImageSummary = argv[++i] || null;
    else if (arg === '--reference-user-intent') cfg.referenceUserIntent = argv[++i] || '';
    else if (arg === '--reference-keep') cfg.referenceKeep = argv[++i] || '';
    else if (arg === '--reference-change') cfg.referenceChange = argv[++i] || '';
    else if (arg === '--routing-brief') cfg.routingBrief = argv[++i] || null;
    else if (arg === '--routing-brief-file') cfg.routingBriefFile = argv[++i] || null;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return cfg;
}

async function readQuery(query, queryFile) {
  if (query) return String(query).trim();
  if (queryFile) return (await readFile(path.resolve(queryFile), 'utf8')).trim();
  return '';
}

async function runJsonScript(scriptName, args) {
  const { stdout } = await execFile(process.execPath, [path.join(root, 'scripts', scriptName), ...args], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function targetExists(target) {
  if (!target) return false;
  try {
    await readFile(path.join(root, target), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function composerConfidence(composition) {
  const primary = composition?.compositionPlan?.primary;
  if (!primary) return 0;
  const evidenceHits = (primary.evidence || []).reduce((sum, item) => sum + (item.hits?.length || 0), 0);
  return Math.max(primary.score || 0, primary.roleScores?.primary || 0) + Math.min(12, evidenceHits * 2);
}

async function buildComposerResolution(cfg, selectionQuery, routingBrief) {
  if (cfg.selectorDebug || cfg.target || cfg.templateId || !selectionQuery) return null;
  const composition = await composeTemplatesForQuery(selectionQuery, routingBrief);
  const primaryTarget = composition.compositionPlan?.primary?.target || null;
  const confidence = composerConfidence(composition);
  if (!primaryTarget || confidence < 18 || !(await targetExists(primaryTarget))) {
    return { composition, resolution: null, skipReason: !primaryTarget ? 'no-primary' : confidence < 18 ? 'low-confidence' : 'missing-primary-target' };
  }
  const brief = await runJsonScript('template-brief.mjs', ['--target', primaryTarget, '--query', selectionQuery, '--json']);
  return {
    composition,
    resolution: {
      selection: null,
      resolvedTemplateId: brief.primaryTemplateId || null,
      brief,
    },
  };
}

async function resolveSelectorSelection(cfg, effectiveRequest) {
  let resolvedTemplateId = cfg.templateId;
  let selection = null;
  if (!resolvedTemplateId) {
    if (!effectiveRequest) throw new Error('Need --query/--queryfile or reference-image inputs when no template is preselected.');
    selection = await runJsonScript('select-template.mjs', ['--query', effectiveRequest, '--json']);
    if (selection.clarification?.needed) {
      return { selection, resolvedTemplateId: selection.candidates?.[0]?.templateId || null, brief: null };
    }
    resolvedTemplateId = selection.candidates?.[0]?.templateId || null;
    if (!resolvedTemplateId) throw new Error('Selector did not return a usable template.');
  }
  const briefArgs = ['--template-id', resolvedTemplateId, '--json'];
  if (effectiveRequest) briefArgs.push('--query', effectiveRequest);
  if (cfg.pick != null) briefArgs.push('--pick', String(cfg.pick));
  return { selection, resolvedTemplateId, brief: await runJsonScript('template-brief.mjs', briefArgs) };
}

async function resolveExplicitTarget(cfg, effectiveRequest) {
  if (!cfg.target) return null;
  const briefArgs = ['--target', cfg.target, '--json'];
  if (effectiveRequest) briefArgs.push('--query', effectiveRequest);
  return {
    selection: null,
    resolvedTemplateId: null,
    brief: await runJsonScript('template-brief.mjs', briefArgs),
  };
}

function shouldBlockOnClarification(selection) {
  const clarification = selection?.clarification;
  const candidates = selection?.candidates || [];
  if (!clarification?.needed || !candidates.length) return false;
  const top = candidates[0];
  const second = candidates[1];
  const optionTemplates = new Set((clarification.options || []).map((item) => item.internalTemplateId).filter(Boolean));
  if (!optionTemplates.has(top.templateId)) {
    const topScore = top?.score || 0;
    const secondScore = second?.score || 0;
    if (topScore >= secondScore + 8) return false;
  }
  return true;
}

function templateBasename(target) {
  return String(target || '').split('/').pop()?.replace(/\.md$/, '') || String(target || 'unknown');
}

function compositionHasAcademicStyle(composition) {
  const targets = [
    composition?.compositionPlan?.primary?.target,
    ...(composition?.compositionPlan?.supporting || []).map((item) => item.target),
    ...(composition?.compositionPlan?.style || []).map((item) => item.target),
  ].filter(Boolean).join(' ');
  return /academic-figures|scientific-schematic|publication-chart|method-pipeline-overview|neural-network-architecture/.test(targets);
}

function sanitizeList(items, patterns) {
  return (items || []).filter((item) => !patterns.some((pattern) => pattern.test(String(item || ''))));
}

function stripRoutingNotes(items) {
  const routingPatterns = [
    /→\s*用\s*`?.+?`?$/u,
    /^用户要的是/u,
    /^如果用户要的是/u,
    /^若用户要的是/u,
    /^当用户要的是/u,
  ];
  return (items || []).filter((item) => !routingPatterns.some((pattern) => pattern.test(String(item || '').trim())));
}

function sanitizeBriefForComposition(brief, composition) {
  if (!brief || !composition?.compositionPlan?.primary) return { brief, trace: { enabled: false, reasons: [] } };
  const academicStyle = compositionHasAcademicStyle(composition);
  if (!academicStyle) return { brief, trace: { enabled: false, reasons: [] } };

  const conflictPatterns = [
    /暗色|deep slate|grid|baoyu-diagram/i,
    /位图（不要求可编辑）|用户接受这是位图|很少竖版/i,
    /README|blog 配图|头图/i,
  ];
  const routingPatterns = [
    /→\s*用\s*`?.+?`?$/u,
    /^用户要的是/u,
    /^如果用户要的是/u,
    /^若用户要的是/u,
    /^当用户要的是/u,
  ];
  const originalApplicability = brief.applicability || [];
  const originalUseWhen = brief.useWhen || [];
  const originalAvoid = brief.avoid || [];
  const sanitizedApplicability = stripRoutingNotes(sanitizeList(originalApplicability, conflictPatterns));
  const sanitizedUseWhen = stripRoutingNotes(sanitizeList(originalUseWhen, conflictPatterns));
  const sanitizedAvoid = stripRoutingNotes(originalAvoid);
  const removed = {
    applicability: originalApplicability.filter((item) => !sanitizedApplicability.includes(item)).map((item) => ({ item, reason: routingPatterns.some((p) => p.test(String(item).trim())) ? 'routing-note' : 'style-conflict' })),
    useWhen: originalUseWhen.filter((item) => !sanitizedUseWhen.includes(item)).map((item) => ({ item, reason: routingPatterns.some((p) => p.test(String(item).trim())) ? 'routing-note' : 'style-conflict' })),
    avoid: originalAvoid.filter((item) => !sanitizedAvoid.includes(item)).map((item) => ({ item, reason: 'routing-note' })),
  };

  return {
    brief: {
      ...brief,
      applicability: sanitizedApplicability,
      useWhen: sanitizedUseWhen,
      avoid: sanitizedAvoid,
    },
    trace: {
      enabled: true,
      reasons: ['academic-style-composition'],
      removed,
    },
  };
}

function buildTemplateCategorySummary(composition) {
  if (!composition?.compositionPlan?.primary) return [];
  const plan = composition.compositionPlan;
  const out = [{ role: 'primary', target: plan.primary.target, category: templateBasename(plan.primary.target) }];
  for (const item of plan.supporting || []) out.push({ role: 'supporting', target: item.target, category: templateBasename(item.target) });
  for (const item of plan.style || []) out.push({ role: 'style', target: item.target, category: templateBasename(item.target) });
  return out;
}

function buildTemplateCategoryUserSummary(composition) {
  const summary = buildTemplateCategorySummary(composition);
  if (!summary.length) return [];
  return summary.map((item) => `${item.role}: ${item.category} (${item.target})`);
}

function buildPromptSourceTrace({
  effectiveRequest,
  selectedTarget,
  primaryTarget,
  templateComposition,
  originalBrief,
  effectiveBrief,
  sanitizationTrace,
  primarySelection,
  fragments,
  familyPrinciples,
  textInspection,
  platform,
  ratio,
}) {
  return {
    request: effectiveRequest,
    selectedTarget,
    primaryTarget,
    platform,
    ratio,
    composition: templateComposition ? {
      primary: templateComposition.compositionPlan?.primary?.target || null,
      supporting: (templateComposition.compositionPlan?.supporting || []).map((item) => item.target),
      style: (templateComposition.compositionPlan?.style || []).map((item) => item.target),
      constraints: templateComposition.compositionPlan?.constraints || [],
    } : null,
    sections: [
      { name: 'request-line', source: 'builder', items: [effectiveRequest] },
      { name: 'target-outcome-shape', source: selectedTarget, items: effectiveBrief?.title ? [effectiveBrief.title] : [] },
      { name: 'applicability-anchors', source: selectedTarget, items: effectiveBrief?.applicability || [], originalItems: originalBrief?.applicability || [] },
      { name: 'use-this-structure-when', source: selectedTarget, items: effectiveBrief?.useWhen || [], originalItems: originalBrief?.useWhen || [] },
      { name: 'matched-prompt-direction', source: primarySelection ? 'prompt-intelligence' : null, items: primarySelection?.promptIntelligence?.selectedVariants?.[0]?.notes ? [primarySelection.promptIntelligence.selectedVariants[0].notes] : [] },
      { name: 'prompt-fragments', source: 'prompt-fragments', items: (fragments || []).map((item) => item.title) },
      { name: 'principles', source: 'prompt-principles', items: (familyPrinciples || []).map((item) => item.title) },
      { name: 'text-inspection', source: 'text-qa-gate', items: textInspection?.textInspectionRequired ? (textInspection.inspectionZones || []).map((item) => item.label) : [] },
      { name: 'composition-addon', source: 'template-composition', items: templateComposition ? [templateComposition.compositionPlan?.primary?.target || null, ...(templateComposition.compositionPlan?.supporting || []).map((item) => item.target), ...(templateComposition.compositionPlan?.style || []).map((item) => item.target)].filter(Boolean) : [] },
      { name: 'avoid-list', source: selectedTarget, items: effectiveBrief?.avoid || [], originalItems: originalBrief?.avoid || [] },
    ].filter((section) => section.items && section.items.length),
    sanitization: sanitizationTrace || { enabled: false, reasons: [], removed: { applicability: [], useWhen: [], avoid: [] } },
  };
}

function appendCompositionPrompt(prompt, composition) {
  const plan = composition?.compositionPlan;
  if (!plan?.primary?.target) return prompt;
  const parsed = JSON.parse(prompt);
  parsed.template_composition_plan = {
    primary_structure_template: plan.primary.target,
    supporting_templates_to_borrow_from: (plan.supporting || []).map((item) => item.target),
    style_templates_to_borrow_from: (plan.style || []).map((item) => item.target),
    constraint_signals: plan.constraints || [],
    composition_rule: 'Use the primary template for the visual skeleton; borrow only compatible structure, style, and constraints from supporting templates. Do not merge incompatible product, UI, or report metaphors.',
  };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function printHuman(result) {
  console.log(`# Prompt Build\n`);
  console.log(`Status: ${result.status}`);
  if (result.referenceRebuild) console.log(`Entry mode: ${result.referenceRebuild.entryMode}`);
  if (result.primaryTarget) console.log(`Primary target: ${result.primaryTarget}`);
  if (result.selectedTemplateId) console.log(`Template engine id: ${result.selectedTemplateId}`);
  if (result.selectedTarget) console.log(`Target: ${result.selectedTarget}`);
  if (result.templateCategoryUserSummary?.length) {
    console.log('\n## Referenced template categories');
    result.templateCategoryUserSummary.forEach((item) => console.log(`- ${item}`));
  }
  if (result.selection?.clarification?.needed) {
    console.log('\n## Clarification needed');
    console.log(result.selection.clarification.question);
    result.selection.clarification.options.forEach((option, idx) => console.log(`${idx + 1}. ${option.label} — ${option.description}`));
  }
  if (result.slotClarifications?.needed) {
    console.log('\n## Clarification needed before prompt generation');
    result.slotClarifications.questions.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.question}`);
      (item.options || []).forEach((option, optIdx) => console.log(`   ${String.fromCharCode(65 + optIdx)}. ${option}`));
    });
    if (result.slotClarifications.defaultsApplied?.length) {
      console.log('\n## Defaults only if the user explicitly asks for a fast first pass');
      result.slotClarifications.defaultsApplied.forEach((item) => console.log(`- ${item.id}: ${item.assumed}`));
    }
    return;
  }
  console.log('\n## Final prompt draft\n');
  console.log(result.prompt);
  if (result.textInspection?.textInspectionRequired) {
    console.log('\n## Text QA gate');
    console.log(result.textInspection.deliveryRule);
    result.textInspection.inspectionZones.forEach((zone) => console.log(`- ${zone.label}: ${zone.reason}`));
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();

  const directQuery = await readQuery(cfg.query, cfg.queryFile);
  const referenceRebuild = (cfg.referenceImage || cfg.referenceImageSummary || cfg.referenceUserIntent || cfg.referenceKeep || cfg.referenceChange)
    ? buildReferenceRebuild(cfg)
    : null;
  const effectiveRequest = referenceRebuild?.rebuiltRequest || directQuery;
  const routingBrief = await loadRoutingBrief(cfg.routingBrief, cfg.routingBriefFile, referenceRebuild?.selectionQuery || effectiveRequest);
  const selectionQuery = routingBrief.routingQuery || referenceRebuild?.selectionQuery || effectiveRequest;

  const explicitTargetResolved = await resolveExplicitTarget(cfg, selectionQuery);
  const composerResolved = explicitTargetResolved ? null : await buildComposerResolution(cfg, selectionQuery, routingBrief);
  let resolved = explicitTargetResolved || composerResolved?.resolution || null;
  const templateComposition = resolved && composerResolved?.resolution ? composerResolved.composition : null;
  const composerSkipReason = composerResolved?.skipReason || null;
  if (!resolved) resolved = await resolveSelectorSelection(cfg, selectionQuery);
  if (shouldBlockOnClarification(resolved.selection) && !resolved.brief) {
    const early = {
      status: 'needs-direction-clarify',
      effectiveRequest,
      selectionQuery,
      routingBrief,
      referenceRebuild,
      selection: resolved.selection,
      selectedTemplateId: resolved.resolvedTemplateId,
      selectedTarget: resolved.selection.candidates?.[0]?.rankedTargets?.[0]?.target || null,
      primaryTarget: null,
      templateComposition,
      composerSkipReason,
      prompt: null,
    };
    if (cfg.json) {
      console.log(JSON.stringify(early, null, 2));
      return;
    }
    printHuman(early);
    return;
  }
  const { selection, resolvedTemplateId, brief } = resolved;

  const { promptFragments, principles, clarifyRules, referenceMode, overlapMap } = await loadPromptEngine();
  const composerMode = Boolean(templateComposition);
  const selectedTarget = brief.target;
  const primaryTarget = templateComposition?.compositionPlan?.primary?.target || selectedTarget;
  const selectedTemplateId = composerMode ? null : (brief.primaryTemplateId || resolvedTemplateId);
  const engineProfileId = selectedTemplateId || primaryTarget;
  const composerSanitized = composerMode
    ? sanitizeBriefForComposition({ ...brief, promptIntelligence: [] }, templateComposition)
    : null;
  const effectiveBrief = composerMode ? composerSanitized.brief : brief;
  const promptSourceTrace = buildPromptSourceTrace({
    effectiveRequest,
    selectedTarget,
    primaryTarget,
    templateComposition,
    originalBrief: brief,
    effectiveBrief,
    sanitizationTrace: composerSanitized?.trace,
    primarySelection: composerMode ? null : (brief.promptIntelligence?.[0] || null),
    fragments: [],
    familyPrinciples: [],
    textInspection: null,
    platform: null,
    ratio: null,
  });
  const templateCategorySummary = buildTemplateCategorySummary(templateComposition);
  const templateCategoryUserSummary = buildTemplateCategoryUserSummary(templateComposition);
  const profile = profileForTemplate(engineProfileId, selectedTarget, overlapMap);
  const familyMeta = (principles.families || []).find((item) => item.task_family === profile.primaryTaskFamily) || null;
  const family = profile.primaryTaskFamily || inferFamilyFromTarget(selectedTarget);
  const ratio = detectRatio(effectiveRequest, family, familyMeta?.default_aspect_ratios || []);
  const platform = detectPlatform(effectiveRequest);
  const textInspection = buildTextInspection(effectiveRequest, family);
  const slotClarifications = buildSlotClarifications({
    query: effectiveRequest,
    family,
    clarifyRules,
    brief: effectiveBrief,
    platform,
    ratio,
  });
  const primarySelection = composerMode ? null : (brief.promptIntelligence?.[0] || null);
  const fragments = [];
  const familyPrinciples = principlesForFamily(family, principles);
  promptSourceTrace.fragments = (fragments || []).map((item) => item.title);
  promptSourceTrace.principles = (familyPrinciples || []).map((item) => item.title);
  promptSourceTrace.platform = platform;
  promptSourceTrace.ratio = ratio;

  if (slotClarifications.needed) {
    const result = {
      status: 'needs-slot-clarify',
      effectiveRequest,
      selectionQuery,
      routingBrief,
      referenceRebuild,
      selectedTemplateId,
      selectedTarget,
      primaryTarget,
      templateComposition,
      composerSkipReason,
      templateCategorySummary,
      templateCategoryUserSummary,
      family,
      preferredOutputRatio: ratio,
      platform,
      prompt: null,
      selection,
      slotClarifications,
      textInspection,
      templateBrief: effectiveBrief,
      renderContract: buildRenderContract({
        brief: effectiveBrief,
        promptDraft: null,
        ratio,
        platform,
        family,
      }),
      promptSourceTrace,
      promptEngine: {
        profile,
        principles: familyPrinciples,
        fragments: fragments,
        referenceMode,
        sources: {
          promptFragments: promptFragments.source,
          principles: principles.source,
          clarifyRules: clarifyRules.source,
        },
      },
    };

    if (cfg.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHuman(result);
    return;
  }

  const basePrompt = composePromptDraft({
    effectiveRequest,
    brief: effectiveBrief,
    family,
    ratio,
    platform,
    textInspection,
    primarySelection,
    fragments,
    principles: familyPrinciples,
  });
  const prompt = appendCompositionPrompt(basePrompt, templateComposition);

  const result = {
    status: 'ready',
    effectiveRequest,
    selectionQuery,
    routingBrief,
    referenceRebuild,
    selectedTemplateId,
    selectedTarget,
    primaryTarget,
    templateComposition,
    composerSkipReason,
    templateCategorySummary,
    templateCategoryUserSummary,
    family,
    preferredOutputRatio: ratio,
    platform,
    prompt,
    promptSourceTrace,
    selection,
    slotClarifications,
    textInspection,
    templateBrief: effectiveBrief,
    renderContract: buildRenderContract({
      brief: effectiveBrief,
      promptDraft: prompt,
      ratio,
      platform,
      family,
    }),
    promptEngine: {
      profile,
      principles: familyPrinciples,
      fragments: fragments,
      referenceMode,
      sources: {
        promptFragments: promptFragments.source,
        principles: principles.source,
        clarifyRules: clarifyRules.source,
      },
    },
  };

  if (cfg.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
