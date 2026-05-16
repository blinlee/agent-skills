import process from 'node:process';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);

function printHelp() {
  console.log(`Usage:\n  node scripts/check-codex-route.mjs [--json] [--codex-bin codex]\n`);
}

function parseArgs(argv) {
  const cfg = { json: false, help: false, codexBin: 'codex' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--codex-bin') cfg.codexBin = argv[++i] || 'codex';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function detectCodex(codexBin) {
  try {
    const { stdout, stderr } = await execFile(codexBin, ['--help'], { maxBuffer: 1024 * 1024 });
    return {
      available: true,
      codexBin,
      hint: 'codex-cli',
      helpPreview: String(stdout || stderr || '').slice(0, 200),
      notes: [
        'Codex CLI is available on PATH.',
        'When used for image rendering in OpenClaw, execution must go through exec(pty=true).',
      ],
    };
  } catch (error) {
    return {
      available: false,
      codexBin,
      hint: 'missing-codex-cli',
      error: error instanceof Error ? error.message : String(error),
      notes: ['Codex CLI is not available, so Mode C cannot be used.'],
    };
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();
  const result = await detectCodex(cfg.codexBin);
  if (cfg.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('--- codex route check ---');
    console.log(`available: ${result.available}`);
    console.log(`codexBin: ${result.codexBin}`);
    if (result.error) console.log(`error: ${result.error}`);
    result.notes.forEach((note) => console.log(`- ${note}`));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
