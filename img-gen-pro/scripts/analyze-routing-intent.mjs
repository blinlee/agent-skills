#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRoutingBrief } from './routing-brief.mjs';

function printHelp() {
  console.log(`Usage:
  node scripts/analyze-routing-intent.mjs --query "..." [--json]
  node scripts/analyze-routing-intent.mjs --queryfile request.txt [--json]

Options:
  --query <text>       User request
  --queryfile <path>   Load request text from a file
  --json               Print structured JSON output
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function readQuery(cfg) {
  if (cfg.query) return String(cfg.query).trim();
  if (cfg.queryFile) return (await readFile(path.resolve(cfg.queryFile), 'utf8')).trim();
  throw new Error('Query is required. Use --query or --queryfile.');
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();
  const query = await readQuery(cfg);
  const brief = buildRoutingBrief(query);
  if (cfg.json) console.log(JSON.stringify(brief, null, 2));
  else {
    console.log('# Routing Brief');
    console.log(`visualTaskType: ${brief.visualTaskType}`);
    console.log(`outputPurpose: ${brief.outputPurpose}`);
    console.log(`layoutIntent: ${brief.layoutIntent}`);
    console.log(`routingQuery: ${brief.routingQuery}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

