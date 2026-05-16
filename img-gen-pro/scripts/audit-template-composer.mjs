import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const defaultCasesFile = path.join(root, 'evals', 'template-composer-golden.json');

function parseArgs(argv) {
  const cfg = { cases: defaultCasesFile, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--cases') cfg.cases = path.resolve(argv[++i] || defaultCasesFile);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function runComposer(query) {
  const { stdout } = await execFile(process.execPath, [path.join(root, 'scripts', 'compose-templates.mjs'), '--query', query, '--json'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function includesTarget(items, target) {
  return (items || []).some((item) => item?.target === target || item === target);
}

function check(result, expect = {}) {
  const failures = [];
  const plan = result.compositionPlan || {};
  const primary = plan.primary?.target || null;
  if (expect.primary && primary !== expect.primary) failures.push(`primary expected ${expect.primary}, got ${primary}`);
  for (const target of expect.supportingAny || []) {
    if (!includesTarget(plan.supporting, target)) failures.push(`supporting missing ${target}`);
  }
  if ((expect.styleAny || []).length && !(expect.styleAny || []).some((target) => includesTarget(plan.style, target))) {
    failures.push(`style missing any of ${(expect.styleAny || []).join(', ')}`);
  }
  for (const target of expect.mustNotPrimary || []) {
    if (primary === target) failures.push(`mustNotPrimary violated: ${target}`);
  }
  return failures;
}

function printHuman(results) {
  for (const item of results) {
    const status = item.failures.length ? 'FAIL' : 'PASS';
    console.log(`${status} ${item.name}`);
    console.log(`  primary: ${item.primary}`);
    console.log(`  supporting: ${item.supporting.join(', ') || 'none'}`);
    console.log(`  style: ${item.style.join(', ') || 'none'}`);
    if (item.failures.length) item.failures.forEach((failure) => console.log(`  - ${failure}`));
  }
  const failed = results.filter((item) => item.failures.length).length;
  console.log(`\n${results.length - failed}/${results.length} composer cases passed.`);
  if (failed) process.exitCode = 1;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    console.log('Usage: node scripts/audit-template-composer.mjs [--cases evals/template-composer-golden.json] [--json]');
    return;
  }
  const cases = JSON.parse(await readFile(cfg.cases, 'utf8'));
  const results = [];
  for (const testCase of cases) {
    const result = await runComposer(testCase.query);
    const plan = result.compositionPlan || {};
    const failures = check(result, testCase.expect || {});
    results.push({
      name: testCase.name,
      query: testCase.query,
      primary: plan.primary?.target || null,
      supporting: (plan.supporting || []).map((item) => item.target),
      style: (plan.style || []).map((item) => item.target),
      constraints: plan.constraints || [],
      failures,
      topCandidates: plan.candidates,
    });
  }
  if (cfg.json) console.log(JSON.stringify({ cases: results }, null, 2));
  else printHuman(results);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
