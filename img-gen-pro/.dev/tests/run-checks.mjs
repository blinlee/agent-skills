import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(path.dirname(__dirname));
const casesFile = path.join(__dirname, 'golden-cases.json');

function fail(message) {
  throw new Error(message);
}

async function runJsonScript(scriptName, args) {
  const { stdout } = await execFile(process.execPath, [path.join(root, 'scripts', scriptName), ...args, '--json'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runJsonScriptWithEnv(scriptName, args, env = {}) {
  const { stdout } = await execFile(process.execPath, [path.join(root, 'scripts', scriptName), ...args, '--json'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function expectArrayContainsAll(actual, expected, label) {
  const actualSet = new Set(actual || []);
  for (const item of expected || []) {
    if (!actualSet.has(item)) fail(`${label}: missing ${JSON.stringify(item)} in ${JSON.stringify(actual)}`);
  }
}

function assertSelection(result, expected) {
  if ('clarificationNeeded' in expected) {
    expectEqual(Boolean(result.clarification?.needed), expected.clarificationNeeded, 'clarificationNeeded');
  }
  if (expected.selectedTemplateId) {
    expectEqual(result.candidates?.[0]?.templateId || null, expected.selectedTemplateId, 'selectedTemplateId');
  }
  if (expected.selectedTarget) {
    expectEqual(result.candidates?.[0]?.rankedTargets?.[0]?.target || null, expected.selectedTarget, 'selectedTarget');
  }
  if (expected.clarificationTemplates) {
    const templates = (result.clarification?.options || []).map((item) => item.internalTemplateId).filter(Boolean);
    expectArrayContainsAll(templates, expected.clarificationTemplates, 'clarificationTemplates');
  }
}

function assertBuildPrompt(result, expected) {
  if (expected.status) expectEqual(result.status, expected.status, 'status');
  if (result.status === 'ready') {
    try {
      JSON.parse(result.prompt);
    } catch (error) {
      fail(`promptJson: ready prompt must be strict JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    expectEqual(result.renderContract?.finalHandoffType || null, 'json-prompt-string', 'renderContract.finalHandoffType');
    expectEqual(result.renderContract?.promptFormat || null, 'json', 'renderContract.promptFormat');
    expectEqual(result.renderContract?.hostReadyInput?.format || null, 'json', 'renderContract.hostReadyInput.format');
    if (String(result.prompt || '').includes('Template composition plan:')) {
      fail('promptJson: found retired natural-language composition addon');
    }
    if (String(result.prompt || '').includes('{argument')) {
      fail('promptJson: found unresolved template argument placeholder');
    }
  }
  if (expected.selectedTemplateId) expectEqual(result.selectedTemplateId, expected.selectedTemplateId, 'selectedTemplateId');
  if (expected.selectedTarget) expectEqual(result.selectedTarget, expected.selectedTarget, 'selectedTarget');
  if (expected.preferredOutputRatio) expectEqual(result.preferredOutputRatio, expected.preferredOutputRatio, 'preferredOutputRatio');
  if (expected.family) expectEqual(result.family, expected.family, 'family');
  if (expected.selectionQuery) expectEqual(result.selectionQuery, expected.selectionQuery, 'selectionQuery');
  if ('slotClarificationNeeded' in expected) expectEqual(Boolean(result.slotClarifications?.needed), expected.slotClarificationNeeded, 'slotClarificationNeeded');
  if (expected.routingBriefVisualTaskType) expectEqual(result.routingBrief?.visualTaskType || null, expected.routingBriefVisualTaskType, 'routingBriefVisualTaskType');
  if (expected.routingBriefOutputPurpose) expectEqual(result.routingBrief?.outputPurpose || null, expected.routingBriefOutputPurpose, 'routingBriefOutputPurpose');
  if (expected.primaryTarget) expectEqual(result.primaryTarget || null, expected.primaryTarget, 'primaryTarget');
  if (expected.templateCategoryIncludes) {
    const categories = (result.templateCategorySummary || []).map((item) => item.target);
    for (const target of expected.templateCategoryIncludes) {
      if (!categories.includes(target)) fail(`templateCategoryIncludes: missing ${JSON.stringify(target)} in ${JSON.stringify(categories)}`);
    }
  }
  if (expected.compositionPrimary) expectEqual(result.templateComposition?.compositionPlan?.primary?.target || null, expected.compositionPrimary, 'compositionPrimary');
  if (expected.compositionSupportingAny) {
    const supporting = (result.templateComposition?.compositionPlan?.supporting || []).map((item) => item.target);
    for (const target of expected.compositionSupportingAny) {
      if (!supporting.includes(target)) fail(`compositionSupportingAny: missing ${JSON.stringify(target)} in ${JSON.stringify(supporting)}`);
    }
  }
  if (expected.promptIncludes) {
    for (const fragment of expected.promptIncludes) {
      if (!String(result.prompt || '').includes(fragment)) fail(`promptIncludes: missing ${JSON.stringify(fragment)}`);
    }
  }
  if (expected.promptExcludes) {
    for (const fragment of expected.promptExcludes) {
      if (String(result.prompt || '').includes(fragment)) fail(`promptExcludes: found forbidden ${JSON.stringify(fragment)}`);
    }
  }
  if (expected.promptBodyInjectionAbsent) {
    const retiredMarker = ['Matched prompt', 'body'].join(' ');
    if (String(result.prompt || '').includes(retiredMarker)) fail('promptBodyInjectionAbsent: found retired prompt body marker in prompt');
    const sectionNames = (result.promptSourceTrace?.sections || []).map((section) => section.name);
    if (sectionNames.includes('matched-prompt-body')) fail('promptBodyInjectionAbsent: found retired prompt body trace section');
  }
  if ('textInspectionRequired' in expected) {
    expectEqual(Boolean(result.textInspection?.textInspectionRequired), expected.textInspectionRequired, 'textInspectionRequired');
  }
  if (expected.referenceEntryMode) {
    expectEqual(result.referenceRebuild?.entryMode || null, expected.referenceEntryMode, 'referenceEntryMode');
  }
}

function assertCodexRender(result, expected) {
  if (expected.status) expectEqual(result.status, expected.status, 'status');
  if ('imageExists' in expected) expectEqual(Boolean(result.imageExists), expected.imageExists, 'imageExists');
  if ('outputSuffix' in expected) {
    if (!String(result.outputPath || '').endsWith(expected.outputSuffix)) {
      fail(`outputSuffix: expected path ending with ${JSON.stringify(expected.outputSuffix)}, got ${JSON.stringify(result.outputPath)}`);
    }
  }
  if ('planSuffix' in expected) {
    if (!String(result.planPath || '').endsWith(expected.planSuffix)) {
      fail(`planSuffix: expected path ending with ${JSON.stringify(expected.planSuffix)}, got ${JSON.stringify(result.planPath)}`);
    }
  }
  if ('resultSuffix' in expected) {
    if (!String(result.resultPath || '').endsWith(expected.resultSuffix)) {
      fail(`resultSuffix: expected path ending with ${JSON.stringify(expected.resultSuffix)}, got ${JSON.stringify(result.resultPath)}`);
    }
  }
  if ('dryRun' in expected) expectEqual(Boolean(result.dryRun), expected.dryRun, 'dryRun');
}

async function main() {
  const cases = JSON.parse(await readFile(casesFile, 'utf8'));
  const failures = [];

  for (const testCase of cases) {
    try {
      if (testCase.runner === 'select-template') {
        const result = await runJsonScript('select-template.mjs', testCase.args || []);
        assertSelection(result, testCase.expect || {});
      } else if (testCase.runner === 'build-prompt') {
        const result = await runJsonScript('build-prompt.mjs', testCase.args || []);
        assertBuildPrompt(result, testCase.expect || {});
      } else if (testCase.runner === 'run-codex-render') {
        const result = await runJsonScriptWithEnv('run-codex-render.mjs', testCase.args || [], testCase.env || {});
        assertCodexRender(result, testCase.expect || {});
      } else {
        fail(`Unknown runner: ${testCase.runner}`);
      }
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures.push({
        name: testCase.name,
        message: error instanceof Error ? error.message : String(error),
      });
      console.log(`FAIL ${testCase.name}`);
      console.log(`  ${failures[failures.length - 1].message}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} golden case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} golden cases passed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
