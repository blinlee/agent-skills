import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function printHelp() {
  console.log(`Usage:
  node scripts/explain-prompt-sources.mjs --query "顶刊论文 SLAM 架构图"
  node scripts/explain-prompt-sources.mjs --queryfile /tmp/request.txt --json

Options:
  --query <text>       User request
  --queryfile <path>   Load request from file
  --json               Print structured JSON
  -h, --help           Show help`);
}

function parseArgs(argv) {
  const cfg = { query: null, queryFile: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return cfg;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();
  if (!cfg.query && !cfg.queryFile) throw new Error('Need --query or --queryfile');

  const args = ['scripts/build-prompt.mjs'];
  if (cfg.query) args.push('--query', cfg.query);
  if (cfg.queryFile) args.push('--queryfile', cfg.queryFile);
  args.push('--json');

  const { stdout } = await execFile(process.execPath, args, {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  const trace = result.promptSourceTrace || null;

  if (cfg.json) {
    console.log(JSON.stringify({
      status: result.status,
      selectedTarget: result.selectedTarget,
      primaryTarget: result.primaryTarget,
      promptSourceTrace: trace,
    }, null, 2));
    return;
  }

  console.log('# Prompt Source Trace\n');
  console.log(`Status: ${result.status}`);
  console.log(`Selected target: ${result.selectedTarget || 'none'}`);
  console.log(`Primary target: ${result.primaryTarget || 'none'}\n`);

  if (!trace) {
    console.log('No prompt source trace available.');
    return;
  }

  console.log('## Composition');
  if (trace.composition) {
    console.log(`- primary: ${trace.composition.primary || 'none'}`);
    console.log(`- supporting: ${trace.composition.supporting.join(', ') || 'none'}`);
    console.log(`- style: ${trace.composition.style.join(', ') || 'none'}`);
    console.log(`- constraints: ${trace.composition.constraints.join(', ') || 'none'}`);
  } else {
    console.log('- none');
  }

  console.log('\n## Sections');
  for (const section of trace.sections || []) {
    console.log(`- ${section.name} <- ${section.source}`);
    for (const item of section.items || []) console.log(`  - ${item}`);
  }

  console.log('\n## Sanitization');
  console.log(`- enabled: ${trace.sanitization?.enabled ? 'yes' : 'no'}`);
  if (trace.sanitization?.reasons?.length) console.log(`- reasons: ${trace.sanitization.reasons.join(', ')}`);
  const removed = trace.sanitization?.removed || {};
  for (const key of ['applicability', 'useWhen', 'avoid']) {
    const items = removed[key] || [];
    if (!items.length) continue;
    console.log(`- removed from ${key}:`);
    for (const item of items) console.log(`  - [${item.reason}] ${item.item}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
