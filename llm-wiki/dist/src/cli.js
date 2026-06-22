#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptTaxonomyProposal, listTaxonomyProposals, rejectTaxonomyProposal, } from './governance/taxonomy.js';
import { runIngestJob } from './jobs/job-runner.js';
import { runDedupCommand, runDedupFromArgv, runDedupPendingCommand, runDedupCheckCommand, runDedupStatsCommand, runDedupScanCommand, runDedupBackfillCommand, runDedupDecideCommand, runDedupMergeCommand, } from './cli/dedup-command.js';
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
import { runBridgeIndex, runBridgeAccept, runBridgeList, runBridgeReject, runIntakeComplete, runIntakeNext, runIntakePark, runIntakeReject, runIntakeScan, runIntakeStatus, runProfileAccept, runProfileReject, runProfileReview, runProfileSuggest, runQueryRegistry, runRegistryAdd, runRegistryInit, runRegistryList, runRoute, runRouteAccept, runRouteInbox, } from './registry/registry.js';
import { exists } from './shared/fs.js';
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
    const okfDirectoryIndexes = await generateOkfDirectoryIndexes({ knowledgeRoot });
    const index = await runBuildIndex({ knowledgeRoot });
    return {
        kind: 'knowledge',
        knowledgeRoot,
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
export async function runBridgeAcceptCommand(input) {
    return runBridgeAccept(input);
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
    { name: 'bridge-accept', runObjectArgs: (args) => runBridgeAcceptCommand(args) },
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
            extractEntities: Boolean(input.extractEntities),
            extractKeyInfo: Boolean(input.extractKeyInfo),
        })
        : runIngestInboxCommand({ knowledgeRoot: input.knowledgeRoot });
}
export async function runCliFromArgv(argv) {
    const [command, knowledgeRoot, ...rest] = argv;
    if (!command || !knowledgeRoot) {
        throw new Error(CLI_USAGE);
    }
    switch (command) {
        case 'init':
            return runInitCommand({ knowledgeRoot });
        case 'ingest': {
            if (rest[0] === '--okf') {
                const bundleDir = rest[1];
                if (!bundleDir || bundleDir.startsWith('--')) {
                    throw new Error('usage: llm-wiki ingest <knowledgeRoot> --okf <bundleDir> [--auto-index]');
                }
                const remaining = rest.slice(2);
                const autoIndex = remaining.includes('--auto-index');
                const unknownFlags = remaining.filter((arg) => arg !== '--auto-index');
                if (unknownFlags.length > 0) {
                    throw new Error(`Unknown flag for ingest --okf: ${unknownFlags[0]}`);
                }
                return runImportOkfBundleCommand({ knowledgeRoot, bundleDir, autoIndex });
            }
            const [input, ...flagArgs] = rest;
            if (!input) {
                return runIngestInboxCommand({ knowledgeRoot });
            }
            const extractEntities = flagArgs.includes('--extract-entities');
            const extractKeyInfo = flagArgs.includes('--extract-key-info');
            const unknownFlags = flagArgs.filter((arg) => arg !== '--extract-entities' && arg !== '--extract-key-info');
            if (unknownFlags.length > 0) {
                throw new Error(`Unknown flag for ingest: ${unknownFlags[0]}`);
            }
            return runIngestCommand({ knowledgeRoot, input, extractEntities, extractKeyInfo });
        }
        case 'ingest-inbox':
            return runIngestInboxCommand({ knowledgeRoot });
        case 'dedup':
            return runDedupFromArgv(knowledgeRoot, rest);
        case 'query': {
            const queryOptions = parseQueryArgs(rest);
            if (!queryOptions.question) {
                throw new Error('usage: llm-wiki query <knowledgeRoot> <question> [--include-review] [--no-hyde] [--full]');
            }
            return runQueryCommand({
                knowledgeRoot,
                question: queryOptions.question,
                includeReview: queryOptions.includeReview,
                disableHyde: queryOptions.disableHyde,
            });
        }
        case 'query-readiness':
            if (rest.length > 0) {
                throw new Error(`Unknown flag for query-readiness: ${rest[0]}`);
            }
            return runQueryReadinessCommand({ knowledgeRoot });
        case 'embed-index':
            return runEmbedIndexCommand({ knowledgeRoot });
        case 'export-bundle': {
            const flags = parseCliFlags(rest);
            const outputDir = firstFlag(flags, 'okf');
            if (!outputDir) {
                throw new Error('usage: llm-wiki export-bundle <knowledgeRoot> --okf <outputDir> [--archive <archivePath>]');
            }
            return runExportBundleCommand({ knowledgeRoot, outputDir, archivePath: firstFlag(flags, 'archive') });
        }
        case 'lint':
            return runLintCommand({ knowledgeRoot });
        case 'index':
            return runBuildIndexCommand({ knowledgeRoot });
        case 'wiki-overview': {
            if (rest.length > 0) {
                throw new Error(`Unknown flag for wiki-overview: ${rest[0]}`);
            }
            return runWikiOverviewCommand({ knowledgeRoot });
        }
        case 'maintain': {
            if (rest.length > 0) {
                throw new Error(`Unknown flag for maintain: ${rest[0]}`);
            }
            return runMaintainCommand({ knowledgeRoot });
        }
        case 'taxonomy-list':
            return runTaxonomyListCommand({ knowledgeRoot });
        case 'taxonomy-accept': {
            const [slug, ...flagArgs] = rest;
            if (!slug) {
                throw new Error('usage: llm-wiki taxonomy-accept <knowledgeRoot> <proposalSlug> --reviewer <name>');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            if (!reviewer) {
                throw new Error('taxonomy-accept requires --reviewer <name> after human confirmation');
            }
            return runTaxonomyAcceptCommand({ knowledgeRoot, slug, reviewer });
        }
        case 'taxonomy-reject': {
            const [slug, ...flagArgs] = rest;
            if (!slug) {
                throw new Error('usage: llm-wiki taxonomy-reject <knowledgeRoot> <proposalSlug> --reviewer <name> [--reason <reason>]');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            if (!reviewer) {
                throw new Error('taxonomy-reject requires --reviewer <name> after human confirmation');
            }
            return runTaxonomyRejectCommand({
                knowledgeRoot,
                slug,
                reviewer,
                reason: firstFlag(flags, 'reason'),
            });
        }
        case 'status':
            return runStatusCommand({ knowledgeRoot });
        case 'save-synthesis': {
            const [suggestionId, confirmFlag] = rest;
            if (!suggestionId) {
                throw new Error('usage: llm-wiki save-synthesis <knowledgeRoot> <suggestionId> [--confirm]');
            }
            if (confirmFlag && confirmFlag !== '--confirm') {
                throw new Error(`Unknown flag for save-synthesis: ${confirmFlag}`);
            }
            return runSaveSynthesisCommand({
                knowledgeRoot,
                suggestionId,
                confirm: confirmFlag === '--confirm',
            });
        }
        case 'registry-init':
            return runRegistryInitCommand({ registryRoot: knowledgeRoot });
        case 'registry-list':
            return runRegistryListCommand({ registryRoot: knowledgeRoot });
        case 'registry-add': {
            const hasExplicitWikiRoot = Boolean(rest[0]) && !rest[0].startsWith('--');
            const wikiRoot = hasExplicitWikiRoot ? rest[0] : undefined;
            const flagArgs = hasExplicitWikiRoot ? rest.slice(1) : rest;
            const flags = parseCliFlags(flagArgs);
            const id = firstFlag(flags, 'id');
            if (!id) {
                throw new Error('registry-add requires --id <wikiId>');
            }
            return runRegistryAddCommand({
                registryRoot: knowledgeRoot,
                knowledgeRoot: wikiRoot,
                id,
                title: firstFlag(flags, 'title'),
                scope: flags.scope ?? [],
                scopeCore: flags['scope-core'] ?? [],
                scopeAdjacent: flags['scope-adjacent'] ?? [],
                outOfScope: flags['out-of-scope'] ?? [],
                aliases: [...(flags.alias ?? []), ...(flags.aliases ?? [])],
                profileNotes: flags['profile-note'] ?? [],
            });
        }
        case 'route': {
            const [source] = rest;
            if (!source) {
                throw new Error('usage: llm-wiki route <registryRoot> <sourcePathOrUrl>');
            }
            return runRouteCommand({ registryRoot: knowledgeRoot, source });
        }
        case 'route-inbox':
            return runRouteInboxCommand({ registryRoot: knowledgeRoot });
        case 'bridge-index':
            return runBridgeIndexCommand({ registryRoot: knowledgeRoot });
        case 'bridge-list':
            return runBridgeListCommand({ registryRoot: knowledgeRoot });
        case 'bridge-accept': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki bridge-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            if (!reviewer) {
                throw new Error('bridge-accept requires --reviewer <name>');
            }
            return runBridgeAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') });
        }
        case 'bridge-reject': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki bridge-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const reason = firstFlag(flags, 'reason');
            if (!reviewer) {
                throw new Error('bridge-reject requires --reviewer <name>');
            }
            if (!reason) {
                throw new Error('bridge-reject requires --reason <reason>');
            }
            return runBridgeRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason });
        }
        case 'route-accept': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>]');
            }
            const flags = parseCliFlags(flagArgs);
            return runRouteAcceptCommand({
                registryRoot: knowledgeRoot,
                proposalId,
                wikiId: firstFlag(flags, 'wiki'),
                reviewer: firstFlag(flags, 'reviewer'),
            });
        }
        case 'query-registry': {
            const question = rest.filter((arg) => arg !== '--full').join(' ').trim();
            if (!question) {
                throw new Error('usage: llm-wiki query-registry <registryRoot> <question> [--full]');
            }
            return runQueryRegistryCommand({ registryRoot: knowledgeRoot, question });
        }
        case 'intake-scan':
            return runIntakeScanCommand({ registryRoot: knowledgeRoot });
        case 'intake-status':
            return runIntakeStatusCommand({ registryRoot: knowledgeRoot });
        case 'intake-next':
            return runIntakeNextCommand({ registryRoot: knowledgeRoot });
        case 'intake-complete': {
            const [itemId, ...flagArgs] = rest;
            if (!itemId) {
                throw new Error('usage: llm-wiki intake-complete <registryRoot> <itemId> [--reviewer <name>]');
            }
            const flags = parseCliFlags(flagArgs);
            return runIntakeCompleteCommand({ registryRoot: knowledgeRoot, itemId, reviewer: firstFlag(flags, 'reviewer') });
        }
        case 'intake-reject': {
            const [itemId, ...flagArgs] = rest;
            if (!itemId) {
                throw new Error('usage: llm-wiki intake-reject <registryRoot> <itemId> --reviewer <name> --reason <reason>');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const reason = firstFlag(flags, 'reason');
            if (!reviewer) {
                throw new Error('intake-reject requires --reviewer <name>');
            }
            if (!reason) {
                throw new Error('intake-reject requires --reason <reason>');
            }
            return runIntakeRejectCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason });
        }
        case 'intake-park': {
            const [itemId, ...flagArgs] = rest;
            if (!itemId) {
                throw new Error('usage: llm-wiki intake-park <registryRoot> <itemId> --reviewer <name> --reason <reason>');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const reason = firstFlag(flags, 'reason');
            if (!reviewer) {
                throw new Error('intake-park requires --reviewer <name>');
            }
            if (!reason) {
                throw new Error('intake-park requires --reason <reason>');
            }
            return runIntakeParkCommand({ registryRoot: knowledgeRoot, itemId, reviewer, reason });
        }
        case 'profile-suggest': {
            const flags = parseCliFlags(rest);
            return runProfileSuggestCommand({
                registryRoot: knowledgeRoot,
                intakeItemId: firstFlag(flags, 'from'),
                source: firstFlag(flags, 'source'),
                id: firstFlag(flags, 'id'),
                title: firstFlag(flags, 'title'),
            });
        }
        case 'profile-accept': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki profile-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            if (!reviewer) {
                throw new Error('profile-accept requires --reviewer <name>');
            }
            return runProfileAcceptCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') });
        }
        case 'profile-reject': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki profile-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const reason = firstFlag(flags, 'reason');
            if (!reviewer) {
                throw new Error('profile-reject requires --reviewer <name>');
            }
            if (!reason) {
                throw new Error('profile-reject requires --reason <reason>');
            }
            return runProfileRejectCommand({ registryRoot: knowledgeRoot, proposalId, reviewer, reason });
        }
        case 'profile-review':
            return runProfileReviewCommand({ registryRoot: knowledgeRoot });
        default:
            throw new Error(`unknown command: ${command}`);
    }
}
export async function runCliMain(argv = process.argv.slice(2)) {
    const result = await runCliFromArgv(argv);
    process.stdout.write(`${JSON.stringify(formatCliResult(argv, result), null, 2)}\n`);
}
function parseQueryArgs(args) {
    const questionParts = [];
    let includeReview = false;
    let disableHyde = false;
    let full = false;
    for (const arg of args) {
        if (arg === '--include-review') {
            includeReview = true;
            continue;
        }
        if (arg === '--no-hyde') {
            disableHyde = true;
            continue;
        }
        if (arg === '--full') {
            full = true;
            continue;
        }
        questionParts.push(arg);
    }
    return {
        question: questionParts.join(' ').trim(),
        includeReview,
        disableHyde,
        full,
    };
}
function formatCliResult(argv, result) {
    const command = argv[0];
    const full = argv.includes('--full');
    if (full) {
        return result;
    }
    if (command === 'query' && isQueryCommandResult(result)) {
        return {
            question: result.question,
            answerability: result.sourceReadingPack.answerability,
            readiness: result.readiness,
            sourceReadingPack: result.sourceReadingPack,
        };
    }
    if (command === 'query-registry' && isQueryRegistryResult(result)) {
        return {
            question: result.question,
            answerability: result.sourceReadingPack.answerability,
            readiness: result.diagnostics.readiness,
            sourceReadingPack: result.sourceReadingPack,
        };
    }
    return result;
}
function isQueryCommandResult(result) {
    return Boolean(result && typeof result === 'object' && 'sourceReadingPack' in result && 'grounding' in result);
}
function isQueryRegistryResult(result) {
    return Boolean(result && typeof result === 'object' && 'sourceReadingPack' in result && 'selectedWikis' in result);
}
function parseCliFlags(args) {
    const flags = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg?.startsWith('--')) {
            throw new Error(`Unexpected positional argument: ${arg}`);
        }
        const key = arg.slice(2);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for flag: ${arg}`);
        }
        flags[key] = [...(flags[key] ?? []), value];
        index += 1;
    }
    return flags;
}
function firstFlag(flags, key) {
    return flags[key]?.[0];
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
