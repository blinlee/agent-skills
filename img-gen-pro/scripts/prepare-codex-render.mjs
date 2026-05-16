import path from 'node:path';
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildDefaultImagePath, readPromptInput } from './shared.js';

function printHelp() {
  console.log(`Usage:
  node scripts/prepare-codex-render.mjs --prompt "..." [--output-path out.png] [--json]
  node scripts/prepare-codex-render.mjs --promptfile prompt.md [--output-path out.png] [--json]

Options:
  --prompt <text>          Prompt text
  --promptfile <path>      Prompt file path
  --output-path <path>     Desired image output path (defaults under garden-gpt-image-2/image/)
  --instruction-path <p>   Explicit instruction file path
  --last-message-path <p>  Explicit codex last-message path
  --codex-bin <name>       Codex binary name/path (default: codex)
  --json                   Print JSON payload
  -h, --help               Show help`);
}

function parseArgs(argv) {
  const cfg = {
    prompt: null,
    promptFile: null,
    outputPath: null,
    instructionPath: null,
    lastMessagePath: null,
    codexBin: 'codex',
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--prompt') cfg.prompt = argv[++i] || null;
    else if (arg === '--promptfile') cfg.promptFile = argv[++i] || null;
    else if (arg === '--output-path') cfg.outputPath = argv[++i] || null;
    else if (arg === '--instruction-path') cfg.instructionPath = argv[++i] || null;
    else if (arg === '--last-message-path') cfg.lastMessagePath = argv[++i] || null;
    else if (arg === '--codex-bin') cfg.codexBin = argv[++i] || 'codex';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildInstruction(promptText, filename) {
  return [
    "Use Codex's built-in image generation capability if available.",
    `Generate exactly one image that follows the prompt below, save it as ${filename} in the current working directory, and reply with only the exact filename you created.`,
    "Do not synthesize the image with local drawing code, ImageMagick, hand-written PNG bytes, or any other non-native fallback.",
    "If built-in image generation is unavailable, reply exactly TOOL_UNAVAILABLE.",
    '',
    'IMAGE PROMPT:',
    String(promptText || '').trim(),
    '',
  ].join('\n');
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();

  const promptText = await readPromptInput(cfg.prompt, cfg.promptFile);
  const outputPath = path.resolve(cfg.outputPath || buildDefaultImagePath('generate', 'codex-render', '.png'));
  const workdir = path.dirname(outputPath);
  const instructionPath = path.resolve(cfg.instructionPath || outputPath.replace(/\.png$/i, '.codex-input.txt'));
  const lastMessagePath = path.resolve(cfg.lastMessagePath || outputPath.replace(/\.png$/i, '.codex-last.txt'));

  await mkdir(workdir, { recursive: true });
  await writeFile(instructionPath, buildInstruction(promptText, path.basename(outputPath)), 'utf8');

  const commandPreview = `cat ${quote(instructionPath)} | ${quote(cfg.codexBin)} exec --cd ${quote(workdir)} --skip-git-repo-check --full-auto -o ${quote(lastMessagePath)} -`;

  const result = {
    status: 'prepared',
    route: 'codex-cli',
    outputPath,
    instructionPath,
    lastMessagePath,
    workdir,
    codexBin: cfg.codexBin,
    commandPreview,
    notes: [
      'Run Codex rendering through OpenClaw exec with pty=true.',
      "codex -o saves only the last assistant message, not the full transcript.",
      'Generated images should be saved locally first; do not auto-send them back to chat.',
    ],
  };

  if (cfg.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('# Codex render plan');
    console.log(`route: ${result.route}`);
    console.log(`outputPath: ${result.outputPath}`);
    console.log(`instructionPath: ${result.instructionPath}`);
    console.log(`lastMessagePath: ${result.lastMessagePath}`);
    console.log(`workdir: ${result.workdir}`);
    console.log('');
    console.log(result.commandPreview);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
