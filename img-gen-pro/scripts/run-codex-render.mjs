#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  buildDefaultImagePath,
  loadAmbientEnv,
  readPromptInput,
  savePrompt,
  slugify,
  buildDefaultPromptPath,
} from './shared.js';

function printHelp() {
  console.log(`Usage:
  node scripts/run-codex-render.mjs --prompt "..." [--output-path out.png] [--json]
  node scripts/run-codex-render.mjs --promptfile prompt.md [--output-path out.png] [--json]

Options:
  --prompt <text>            Prompt text
  --promptfile <path>        Prompt file path
  --prompt-output <path>     Save final prompt to a specific file
  --output-path <path>       Output image path (defaults under garden-gpt-image-2/image/)
  --instruction-path <path>  Explicit instruction file path
  --last-message-path <path> Explicit codex last-message path
  --plan-path <path>         Explicit execution plan JSON path
  --result-path <path>       Explicit execution result JSON path
  --codex-bin <name>         Codex binary name/path (default: codex)
  --dry-run                  Prepare artifacts only; do not execute codex
  --json                     Print JSON payload
  -h, --help                 Show help`);
}

function parseArgs(argv) {
  const cfg = {
    prompt: null,
    promptFile: null,
    promptOutput: null,
    outputPath: null,
    instructionPath: null,
    lastMessagePath: null,
    planPath: null,
    resultPath: null,
    codexBin: 'codex',
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--dry-run') cfg.dryRun = true;
    else if (arg === '--prompt') cfg.prompt = argv[++i] || null;
    else if (arg === '--promptfile') cfg.promptFile = argv[++i] || null;
    else if (arg === '--prompt-output') cfg.promptOutput = argv[++i] || null;
    else if (arg === '--output-path') cfg.outputPath = argv[++i] || null;
    else if (arg === '--instruction-path') cfg.instructionPath = argv[++i] || null;
    else if (arg === '--last-message-path') cfg.lastMessagePath = argv[++i] || null;
    else if (arg === '--plan-path') cfg.planPath = argv[++i] || null;
    else if (arg === '--result-path') cfg.resultPath = argv[++i] || null;
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
    'Do not synthesize the image with local drawing code, ImageMagick, hand-written PNG bytes, or any other non-native fallback.',
    'If built-in image generation is unavailable, reply exactly TOOL_UNAVAILABLE.',
    '',
    'IMAGE PROMPT:',
    String(promptText || '').trim(),
    '',
  ].join('\n');
}

function buildPaths(cfg) {
  const outputPath = path.resolve(cfg.outputPath || buildDefaultImagePath('generate', 'codex-render', '.png'));
  const instructionPath = path.resolve(cfg.instructionPath || outputPath.replace(/\.png$/i, '.codex-input.txt'));
  const lastMessagePath = path.resolve(cfg.lastMessagePath || outputPath.replace(/\.png$/i, '.codex-last.txt'));
  const planPath = path.resolve(cfg.planPath || outputPath.replace(/\.png$/i, '.plan.json'));
  const resultPath = path.resolve(cfg.resultPath || outputPath.replace(/\.png$/i, '.result.json'));
  const workdir = path.dirname(outputPath);
  return { outputPath, instructionPath, lastMessagePath, planPath, resultPath, workdir };
}

async function exists(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function readTrimmed(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildCommandPreview(plan) {
  return `cat ${quote(plan.instructionPath)} | ${quote(plan.codexBin)} exec --cd ${quote(plan.workdir)} --skip-git-repo-check --full-auto -o ${quote(plan.lastMessagePath)} -`;
}

async function preparePlan(cfg) {
  const promptText = await readPromptInput(cfg.prompt, cfg.promptFile);
  const nameHint = slugify(promptText.split(/\s+/).slice(0, 8).join(' '), 'codex-render');
  const promptPath = await savePrompt(promptText, cfg.promptOutput || buildDefaultPromptPath(nameHint), nameHint);
  const paths = buildPaths(cfg);
  await mkdir(paths.workdir, { recursive: true });
  await writeFile(paths.instructionPath, buildInstruction(promptText, path.basename(paths.outputPath)), 'utf8');
  const plan = {
    status: 'prepared',
    route: 'codex-cli',
    promptPath,
    promptText,
    outputPath: paths.outputPath,
    instructionPath: paths.instructionPath,
    lastMessagePath: paths.lastMessagePath,
    planPath: paths.planPath,
    resultPath: paths.resultPath,
    workdir: paths.workdir,
    codexBin: cfg.codexBin,
    dryRun: cfg.dryRun,
    commandPreview: buildCommandPreview({ ...paths, codexBin: cfg.codexBin }),
    notes: [
      'Invoke this script itself through OpenClaw exec with pty=true when running from an agent.',
      'codex -o saves only the last assistant message, not the full transcript.',
      'Generated images are saved locally first; inspect before sending anywhere.',
    ],
  };
  await writeJson(paths.planPath, plan);
  return plan;
}

async function runCodex(plan) {
  const instruction = await readFile(plan.instructionPath, 'utf8');
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const child = spawn(plan.codexBin, [
    'exec',
    '--cd', plan.workdir,
    '--skip-git-repo-check',
    '--full-auto',
    '-o', plan.lastMessagePath,
    '-',
  ], {
    cwd: plan.workdir,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  child.stdin.write(instruction);
  child.stdin.end();

  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: code ?? null, signal: signal ?? null }));
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const imageStat = await exists(plan.outputPath);
  const lastMessage = await readTrimmed(plan.lastMessagePath);

  const result = {
    status: 'completed',
    route: plan.route,
    startedAt,
    finishedAt,
    durationMs,
    promptPath: plan.promptPath,
    outputPath: plan.outputPath,
    instructionPath: plan.instructionPath,
    lastMessagePath: plan.lastMessagePath,
    planPath: plan.planPath,
    resultPath: plan.resultPath,
    workdir: plan.workdir,
    codexBin: plan.codexBin,
    exitCode: exit.code,
    signal: exit.signal,
    imageExists: Boolean(imageStat),
    imageBytes: imageStat?.size || 0,
    lastMessage,
    commandPreview: plan.commandPreview,
  };

  if (exit.code !== 0) {
    result.status = 'failed';
    result.error = `Codex exited with code ${exit.code}${exit.signal ? ` (signal: ${exit.signal})` : ''}.`;
  } else if (lastMessage === 'TOOL_UNAVAILABLE') {
    result.status = 'failed';
    result.error = 'Codex reported TOOL_UNAVAILABLE; built-in image generation was not available.';
  } else if (!imageStat) {
    result.status = 'failed';
    result.error = 'Codex exited successfully but the expected image file was not created.';
  } else if (lastMessage && lastMessage !== path.basename(plan.outputPath)) {
    result.status = 'failed';
    result.error = `Codex replied with ${JSON.stringify(lastMessage)} instead of the expected filename ${JSON.stringify(path.basename(plan.outputPath))}.`;
  }

  await writeJson(plan.resultPath, result);
  return result;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();

  await loadAmbientEnv();
  const plan = await preparePlan(cfg);

  if (cfg.dryRun) {
    if (cfg.json) console.log(JSON.stringify(plan, null, 2));
    else console.log(plan.planPath);
    return;
  }

  const result = await runCodex(plan);
  if (cfg.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.status !== 'completed') {
    throw new Error(result.error || 'Codex render failed.');
  }
  console.log(result.outputPath);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
