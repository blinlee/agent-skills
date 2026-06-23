#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptTaxonomyProposal, listTaxonomyProposals, rejectTaxonomyProposal, } from './governance/taxonomy.js';
import { runIngestJob } from './jobs/job-runner.js';
import { runDedupCommand, runDedupPendingCommand, runDedupCheckCommand, runDedupStatsCommand, runDedupScanCommand, runDedupBackfillCommand, runDedupDecideCommand, runDedupMergeCommand, } from './cli/dedup-command.js';
import { runStatusCommand } from './cli/status-command.js';
import { runBuildIndex } from './index/wiki-index.js';
import { runEmbedIndex } from './retrieval/embed-index.js';
import { buildKnowledgeQueryReadiness, buildRegistryQueryReadiness, } from './retrieval/readiness.js';
import { runWikiOverview } from './retrieval/wiki-overview.js';
import { runLint } from './lint/lint.js';
import { defaultKnowledgeLayout, ensureKnowledgeRootLayout } from './paths.js';
import { runQuery } from './query/query.js';
import { runSaveSynthesis } from './query/save-synthesis.js';
import { exportOkfBundle } from './okf/export.js';
import { importOkfBundle } from './okf/import.js';
import { generateOkfDirectoryIndexes, } from './okf/directory-index.js';
import { backfillIncompleteWikiAssets, } from './maintenance/wiki-assets.js';
import { refreshSemanticOverviews, } from './wiki/semantic-overviews.js';
import { runBridgeIndex, runBridgeAccept, runBridgeCreateLanding, runBridgeList, runBridgeReject, runBridgeTargets, runIntakeComplete, runIntakeNext, runIntakePark, runIntakeReject, runIntakeScan, runIntakeStatus, runProfileAccept, runProfileReject, runProfileReview, runProfileSuggest, runQueryRegistry, runRegistryAdd, runRegistryInit, runRegistryList, runRoute, runRouteAccept, runRouteInbox, } from './registry/registry.js';
import { exists } from './shared/fs.js';
import { createRunCliFromArgv, formatCliResult } from './cli/argv.js';
export { runDedupPendingCommand, runDedupCheckCommand, runDedupStatsCommand, runDedupScanCommand, runDedupBackfillCommand, runDedupDecideCommand, runDedupMergeCommand, runStatusCommand, };
export async function runInitCommand(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    await ensureKnowledgeRootLayout(knowledgeRoot);
    return {
        knowledgeRoot,
        createdDirectories: [...defaultKnowledgeLayout],
    };
}
export async function runIngestCommand(input) {
    return runIngestJob(input);
}
export async function runIngestInboxCommand(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    await ensureKnowledgeRootLayout(knowledgeRoot);
    const inboxPath = path.join(knowledgeRoot, 'raw', 'inbox');
    const entries = await readdir(inboxPath, { withFileTypes: true });
    const ingestTargets = entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .filter((entry) => !isInboxControlSidecarName(entry.name))
        .map((entry) => path.join(inboxPath, entry.name))
        .sort((left, right) => left.localeCompare(right));
    const results = [];
    for (const target of ingestTargets) {
        results.push(await runIngestCommand({ knowledgeRoot, input: target }));
    }
    return {
        knowledgeRoot,
        inboxPath,
        results,
    };
}
function isInboxControlSidecarName(name) {
    return name.endsWith('.curation.json') || name.endsWith('.quality.json');
}
export async function runImportOkfBundleCommand(input) {
    return importOkfBundle(input);
}
export async function runQueryCommand(input) {
    return runQuery(input);
}
export async function runEmbedIndexCommand(input) {
    return runEmbedIndex(input);
}
export async function runExportBundleCommand(input) {
    return exportOkfBundle(input);
}
export async function runLintCommand(input) {
    return runLint(input);
}
export async function runBuildIndexCommand(input) {
    return runBuildIndex(input);
}
export async function runWikiOverviewCommand(input) {
    return runWikiOverview(input);
}
export async function runMaintainCommand(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    if (await isRegistryRoot(knowledgeRoot)) {
        return runMaintainRegistryCommand(knowledgeRoot);
    }
    return runMaintainKnowledgeRoot(knowledgeRoot);
}
async function runMaintainKnowledgeRoot(knowledgeRoot) {
    const wikiAssets = await backfillIncompleteWikiAssets({ knowledgeRoot });
    const semanticOverviews = await refreshSemanticOverviews({ knowledgeRoot });
    const okfDirectoryIndexes = await generateOkfDirectoryIndexes({ knowledgeRoot });
    const index = await runBuildIndex({ knowledgeRoot });
    return {
        kind: 'knowledge',
        knowledgeRoot,
        wikiAssets,
        semanticOverviews,
        okfDirectoryIndexes,
        index,
    };
}
async function runMaintainRegistryCommand(registryRoot) {
    const registry = await runRegistryListCommand({ registryRoot });
    const wikis = [];
    for (const wiki of registry.wikis) {
        try {
            const maintained = await runMaintainKnowledgeRoot(wiki.knowledgeRoot);
            wikis.push({
                wikiId: wiki.id,
                title: wiki.title,
                knowledgeRoot: wiki.knowledgeRoot,
                wikiAssets: maintained.wikiAssets,
                semanticOverviews: maintained.semanticOverviews,
                okfDirectoryIndexes: maintained.okfDirectoryIndexes,
                index: maintained.index,
                error: null,
            });
        }
        catch (error) {
            wikis.push({
                wikiId: wiki.id,
                title: wiki.title,
                knowledgeRoot: wiki.knowledgeRoot,
                wikiAssets: null,
                semanticOverviews: null,
                okfDirectoryIndexes: null,
                index: null,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        kind: 'registry',
        registryRoot,
        status: wikis.some((wiki) => wiki.error) ? 'partial' : 'ready',
        wikis,
    };
}
async function isRegistryRoot(root) {
    return await exists(path.join(root, 'system', 'registry', 'registry.json')) || await exists(path.join(root, 'wikis'));
}
export async function runTaxonomyListCommand(input) {
    return listTaxonomyProposals(input.knowledgeRoot);
}
export async function runTaxonomyAcceptCommand(input) {
    const result = await acceptTaxonomyProposal(input.knowledgeRoot, {
        slug: input.slug,
        reviewer: input.reviewer,
    });
    return {
        knowledgeRoot: path.resolve(input.knowledgeRoot),
        slug: input.slug,
        status: 'accepted',
        files: result.files,
    };
}
export async function runTaxonomyRejectCommand(input) {
    const result = await rejectTaxonomyProposal(input.knowledgeRoot, {
        slug: input.slug,
        reviewer: input.reviewer,
        reason: input.reason,
    });
    return {
        knowledgeRoot: path.resolve(input.knowledgeRoot),
        slug: input.slug,
        status: 'rejected',
        files: result.files,
    };
}
export async function runSaveSynthesisCommand(input) {
    return runSaveSynthesis(input);
}
export async function runRegistryInitCommand(input) {
    return runRegistryInit(input);
}
export async function runRegistryAddCommand(input) {
    return runRegistryAdd(input);
}
export async function runRegistryListCommand(input) {
    return runRegistryList(input);
}
export async function runRouteCommand(input) {
    return runRoute(input);
}
export async function runRouteInboxCommand(input) {
    return runRouteInbox(input);
}
export async function runBridgeIndexCommand(input) {
    return runBridgeIndex(input);
}
export async function runBridgeListCommand(input) {
    return runBridgeList(input);
}
export async function runBridgeTargetsCommand(input) {
    return runBridgeTargets(input);
}
export async function runBridgeAcceptCommand(input) {
    return runBridgeAccept(input);
}
export async function runBridgeCreateLandingCommand(input) {
    return runBridgeCreateLanding(input);
}
export async function runBridgeRejectCommand(input) {
    return runBridgeReject(input);
}
export async function runRouteAcceptCommand(input) {
    return runRouteAccept(input);
}
export async function runQueryRegistryCommand(input) {
    return runQueryRegistry(input);
}
export async function runIntakeScanCommand(input) {
    return runIntakeScan(input);
}
export async function runIntakeStatusCommand(input) {
    return runIntakeStatus(input);
}
export async function runIntakeNextCommand(input) {
    return runIntakeNext(input);
}
export async function runIntakeCompleteCommand(input) {
    return runIntakeComplete(input);
}
export async function runIntakeRejectCommand(input) {
    return runIntakeReject(input);
}
export async function runIntakeParkCommand(input) {
    return runIntakePark(input);
}
export async function runProfileSuggestCommand(input) {
    return runProfileSuggest(input);
}
export async function runProfileAcceptCommand(input) {
    return runProfileAccept(input);
}
export async function runProfileRejectCommand(input) {
    return runProfileReject(input);
}
export async function runProfileReviewCommand(input) {
    return runProfileReview(input);
}
export async function runQueryReadinessCommand(input) {
    const root = path.resolve(input.knowledgeRoot);
    if (await isRegistryRoot(root)) {
        const registry = await runRegistryListCommand({ registryRoot: root });
        return buildRegistryQueryReadiness({
            registryRoot: root,
            wikis: registry.wikis.map((wiki) => ({
                wikiId: wiki.id,
                title: wiki.title,
                knowledgeRoot: wiki.knowledgeRoot,
            })),
        });
    }
    return buildKnowledgeQueryReadiness({ knowledgeRoot: root });
}
const CLI_COMMAND_SPECS = [
    { name: 'init', runObjectArgs: (args) => runInitCommand(args) },
    { name: 'ingest', runObjectArgs: (args) => runIngestOrInboxCommand(args) },
    { name: 'ingest-inbox', runObjectArgs: (args) => runIngestInboxCommand(args) },
    { name: 'dedup', runObjectArgs: (args) => runDedupCommand(args) },
    { name: 'query', runObjectArgs: (args) => runQueryCommand(args) },
    { name: 'query-readiness', runObjectArgs: (args) => runQueryReadinessCommand(args) },
    { name: 'embed-index', runObjectArgs: (args) => runEmbedIndexCommand(args) },
    { name: 'export-bundle', runObjectArgs: (args) => runExportBundleCommand(args) },
    { name: 'lint', runObjectArgs: (args) => runLintCommand(args) },
    { name: 'index', runObjectArgs: (args) => runBuildIndexCommand(args) },
    { name: 'wiki-overview', runObjectArgs: (args) => runWikiOverviewCommand(args) },
    { name: 'maintain', runObjectArgs: (args) => runMaintainCommand(args) },
    { name: 'taxonomy-list', runObjectArgs: (args) => runTaxonomyListCommand(args) },
    { name: 'taxonomy-accept', runObjectArgs: (args) => runTaxonomyAcceptCommand(args) },
    { name: 'taxonomy-reject', runObjectArgs: (args) => runTaxonomyRejectCommand(args) },
    { name: 'status', runObjectArgs: (args) => runStatusCommand(args) },
    { name: 'save-synthesis', runObjectArgs: (args) => runSaveSynthesisCommand(args) },
    { name: 'registry-init', runObjectArgs: (args) => runRegistryInitCommand(args) },
    { name: 'registry-add', runObjectArgs: (args) => runRegistryAddCommand(args) },
    { name: 'registry-list', runObjectArgs: (args) => runRegistryListCommand(args) },
    { name: 'route', runObjectArgs: (args) => runRouteCommand(args) },
    { name: 'route-inbox', runObjectArgs: (args) => runRouteInboxCommand(args) },
    { name: 'route-accept', runObjectArgs: (args) => runRouteAcceptCommand(args) },
    { name: 'bridge-index', runObjectArgs: (args) => runBridgeIndexCommand(args) },
    { name: 'bridge-list', runObjectArgs: (args) => runBridgeListCommand(args) },
    { name: 'bridge-targets', runObjectArgs: (args) => runBridgeTargetsCommand(args) },
    { name: 'bridge-accept', runObjectArgs: (args) => runBridgeAcceptCommand(args) },
    { name: 'bridge-create-landing', runObjectArgs: (args) => runBridgeCreateLandingCommand(args) },
    { name: 'bridge-reject', runObjectArgs: (args) => runBridgeRejectCommand(args) },
    { name: 'query-registry', runObjectArgs: (args) => runQueryRegistryCommand(args) },
    { name: 'intake-scan', runObjectArgs: (args) => runIntakeScanCommand(args) },
    { name: 'intake-status', runObjectArgs: (args) => runIntakeStatusCommand(args) },
    { name: 'intake-next', runObjectArgs: (args) => runIntakeNextCommand(args) },
    { name: 'intake-complete', runObjectArgs: (args) => runIntakeCompleteCommand(args) },
    { name: 'intake-reject', runObjectArgs: (args) => runIntakeRejectCommand(args) },
    { name: 'intake-park', runObjectArgs: (args) => runIntakeParkCommand(args) },
    { name: 'profile-suggest', runObjectArgs: (args) => runProfileSuggestCommand(args) },
    { name: 'profile-accept', runObjectArgs: (args) => runProfileAcceptCommand(args) },
    { name: 'profile-reject', runObjectArgs: (args) => runProfileRejectCommand(args) },
    { name: 'profile-review', runObjectArgs: (args) => runProfileReviewCommand(args) },
];
const CLI_COMMAND_NAMES = CLI_COMMAND_SPECS.map((spec) => spec.name);
const CLI_USAGE = `usage: llm-wiki <${CLI_COMMAND_NAMES.join('|')}> <knowledgeRoot|registryRoot> [...args]`;
export function buildCli() {
    return {
        commands: CLI_COMMAND_SPECS.map((spec) => ({
            name: () => spec.name,
            run: spec.runObjectArgs,
        })),
    };
}
function runIngestOrInboxCommand(input) {
    return typeof input.input === 'string' && input.input.trim().length > 0
        ? runIngestCommand({
            knowledgeRoot: input.knowledgeRoot,
            input: input.input,
            qualityPath: input.qualityPath,
            curationPath: input.curationPath,
            extractEntities: Boolean(input.extractEntities),
            extractKeyInfo: Boolean(input.extractKeyInfo),
            forceRecompile: Boolean(input.forceRecompile),
        })
        : runIngestInboxCommand({ knowledgeRoot: input.knowledgeRoot });
}
export const runCliFromArgv = createRunCliFromArgv({
    runInitCommand,
    runIngestCommand: (input) => runIngestCommand(input),
    runIngestInboxCommand,
    runImportOkfBundleCommand: (input) => runImportOkfBundleCommand(input),
    runQueryCommand: (input) => runQueryCommand(input),
    runQueryReadinessCommand,
    runEmbedIndexCommand,
    runExportBundleCommand: (input) => runExportBundleCommand(input),
    runLintCommand,
    runBuildIndexCommand,
    runWikiOverviewCommand,
    runMaintainCommand,
    runTaxonomyListCommand,
    runTaxonomyAcceptCommand: (input) => runTaxonomyAcceptCommand(input),
    runTaxonomyRejectCommand: (input) => runTaxonomyRejectCommand(input),
    runStatusCommand,
    runSaveSynthesisCommand: (input) => runSaveSynthesisCommand(input),
    runRegistryInitCommand,
    runRegistryAddCommand: (input) => runRegistryAddCommand(input),
    runRegistryListCommand,
    runRouteCommand: (input) => runRouteCommand(input),
    runRouteInboxCommand,
    runRouteAcceptCommand: (input) => runRouteAcceptCommand(input),
    runBridgeIndexCommand,
    runBridgeListCommand,
    runBridgeTargetsCommand: (input) => runBridgeTargetsCommand(input),
    runBridgeAcceptCommand: (input) => runBridgeAcceptCommand(input),
    runBridgeCreateLandingCommand: (input) => runBridgeCreateLandingCommand(input),
    runBridgeRejectCommand: (input) => runBridgeRejectCommand(input),
    runQueryRegistryCommand: (input) => runQueryRegistryCommand(input),
    runIntakeScanCommand,
    runIntakeStatusCommand,
    runIntakeNextCommand,
    runIntakeCompleteCommand: (input) => runIntakeCompleteCommand(input),
    runIntakeRejectCommand: (input) => runIntakeRejectCommand(input),
    runIntakeParkCommand: (input) => runIntakeParkCommand(input),
    runProfileSuggestCommand: (input) => runProfileSuggestCommand(input),
    runProfileAcceptCommand: (input) => runProfileAcceptCommand(input),
    runProfileRejectCommand: (input) => runProfileRejectCommand(input),
    runProfileReviewCommand,
}, CLI_USAGE);
export async function runCliMain(argv = process.argv.slice(2)) {
    const result = await runCliFromArgv(argv);
    process.stdout.write(`${JSON.stringify(formatCliResult(argv, result), null, 2)}\n`);
}
function isDirectCliExecution() {
    return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
if (isDirectCliExecution()) {
    runCliMain().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
