import process from 'node:process';
import { buildReferenceRebuild } from './prompt-compose-utils.mjs';

function printHelp() {
  console.log(`Usage:
  node scripts/reference-rebuild.mjs --reference-image-summary "short visual summary" [--reference-user-intent "..."] [--json]

Options:
  --reference-image <path>         Optional local reference-image path for traceability
  --reference-image-summary <text> Visual summary produced by the multimodal controller after inspecting the image
  --reference-user-intent <text>   Requested recreation goal or modifications
  --reference-keep <text>          Explicit keep note
  --reference-change <text>        Explicit change note
  --json                           Print structured JSON output
  -h, --help                       Show help`);
}

function parseArgs(argv) {
  const cfg = {
    referenceImage: null,
    referenceImageSummary: null,
    referenceUserIntent: '',
    referenceKeep: '',
    referenceChange: '',
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--reference-image') cfg.referenceImage = argv[++i] || null;
    else if (arg === '--reference-image-summary') cfg.referenceImageSummary = argv[++i] || null;
    else if (arg === '--reference-user-intent') cfg.referenceUserIntent = argv[++i] || '';
    else if (arg === '--reference-keep') cfg.referenceKeep = argv[++i] || '';
    else if (arg === '--reference-change') cfg.referenceChange = argv[++i] || '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  return cfg;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();
  const result = buildReferenceRebuild(cfg);
  if (cfg.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.rebuiltRequest);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
