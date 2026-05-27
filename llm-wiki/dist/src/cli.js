#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { acceptTaxonomyProposal, listTaxonomyProposals, rejectTaxonomyProposal, } from './governance/taxonomy.js';
import { runIngestJob } from './jobs/job-runner.js';
import { runBuildIndex } from './index/wiki-index.js';
import { runLint } from './lint/lint.js';
import { defaultKnowledgeLayout, ensureKnowledgeRootLayout, requiredKnowledgeFiles } from './paths.js';
import { runQuery } from './query/query.js';
import { runSaveSynthesis } from './query/save-synthesis.js';
import { runBridgeIndex, runBridgeAccept, runBridgeList, runBridgeReject, runIntakeComplete, runIntakeNext, runIntakePark, runIntakeReject, runIntakeScan, runIntakeStatus, runProfileAccept, runProfileReject, runProfileReview, runProfileSuggest, runQueryRegistry, runRegistryAdd, runRegistryInit, runRegistryList, runRoute, runRouteAccept, runRouteInbox, } from './registry/registry.js';
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
export async function runQueryCommand(input) {
    return runQuery(input);
}
export async function runLintCommand(input) {
    return runLint(input);
}
export async function runBuildIndexCommand(input) {
    return runBuildIndex(input);
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
export async function runStatusCommand(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    const configSummary = loadConfig({
        knowledgeRoot,
        jobStorePath: path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
    });
    const requiredDirectories = await summarizeRequiredPaths(knowledgeRoot, defaultKnowledgeLayout);
    const requiredFiles = await summarizeRequiredPaths(knowledgeRoot, requiredKnowledgeFiles.map((file) => file.relativePath));
    const jobCountsByState = await readJobCounts(configSummary.jobStorePath);
    const jobCounts = { ...jobCountsByState };
    const readiness = requiredDirectories.missing.length === 0 && requiredFiles.missing.length === 0
        ? 'ready'
        : 'incomplete';
    return {
        knowledgeRoot,
        knowledgeRootExists: await exists(knowledgeRoot),
        readiness,
        configSummary,
        jobCounts,
        jobCountsByState,
        requiredDirectories,
        requiredFiles,
    };
}
export function buildCli() {
    return {
        commands: [
            { name: () => 'init', run: (args) => runInitCommand(args) },
            { name: () => 'ingest', run: (args) => runIngestOrInboxCommand(args) },
            { name: () => 'ingest-inbox', run: (args) => runIngestInboxCommand(args) },
            { name: () => 'query', run: (args) => runQueryCommand(args) },
            { name: () => 'lint', run: (args) => runLintCommand(args) },
            { name: () => 'index', run: (args) => runBuildIndexCommand(args) },
            { name: () => 'taxonomy-list', run: (args) => runTaxonomyListCommand(args) },
            { name: () => 'taxonomy-accept', run: (args) => runTaxonomyAcceptCommand(args) },
            { name: () => 'taxonomy-reject', run: (args) => runTaxonomyRejectCommand(args) },
            { name: () => 'status', run: (args) => runStatusCommand(args) },
            { name: () => 'save-synthesis', run: (args) => runSaveSynthesisCommand(args) },
            { name: () => 'registry-init', run: (args) => runRegistryInitCommand(args) },
            { name: () => 'registry-add', run: (args) => runRegistryAddCommand(args) },
            { name: () => 'registry-list', run: (args) => runRegistryListCommand(args) },
            { name: () => 'route', run: (args) => runRouteCommand(args) },
            { name: () => 'route-inbox', run: (args) => runRouteInboxCommand(args) },
            { name: () => 'bridge-index', run: (args) => runBridgeIndexCommand(args) },
            { name: () => 'bridge-list', run: (args) => runBridgeListCommand(args) },
            { name: () => 'bridge-accept', run: (args) => runBridgeAcceptCommand(args) },
            { name: () => 'bridge-reject', run: (args) => runBridgeRejectCommand(args) },
            { name: () => 'route-accept', run: (args) => runRouteAcceptCommand(args) },
            { name: () => 'query-registry', run: (args) => runQueryRegistryCommand(args) },
            { name: () => 'intake-scan', run: (args) => runIntakeScanCommand(args) },
            { name: () => 'intake-status', run: (args) => runIntakeStatusCommand(args) },
            { name: () => 'intake-next', run: (args) => runIntakeNextCommand(args) },
            { name: () => 'intake-complete', run: (args) => runIntakeCompleteCommand(args) },
            { name: () => 'intake-reject', run: (args) => runIntakeRejectCommand(args) },
            { name: () => 'intake-park', run: (args) => runIntakeParkCommand(args) },
            { name: () => 'profile-suggest', run: (args) => runProfileSuggestCommand(args) },
            { name: () => 'profile-accept', run: (args) => runProfileAcceptCommand(args) },
            { name: () => 'profile-reject', run: (args) => runProfileRejectCommand(args) },
            { name: () => 'profile-review', run: (args) => runProfileReviewCommand(args) },
        ],
    };
}
function runIngestOrInboxCommand(input) {
    return typeof input.input === 'string' && input.input.trim().length > 0
        ? runIngestCommand({ knowledgeRoot: input.knowledgeRoot, input: input.input })
        : runIngestInboxCommand({ knowledgeRoot: input.knowledgeRoot });
}
export async function runCliFromArgv(argv) {
    const [command, knowledgeRoot, ...rest] = argv;
    if (!command || !knowledgeRoot) {
        throw new Error('usage: llm-wiki <init|ingest|ingest-inbox|query|lint|index|taxonomy-list|taxonomy-accept|taxonomy-reject|status|save-synthesis|registry-init|registry-add|registry-list|route|route-inbox|route-accept|bridge-index|bridge-list|bridge-accept|bridge-reject|query-registry|intake-scan|intake-status|intake-next|intake-complete|intake-reject|intake-park|profile-suggest|profile-accept|profile-reject|profile-review> <knowledgeRoot|registryRoot> [...args]');
    }
    switch (command) {
        case 'init':
            return runInitCommand({ knowledgeRoot });
        case 'ingest': {
            const [input] = rest;
            if (!input) {
                return runIngestInboxCommand({ knowledgeRoot });
            }
            return runIngestCommand({ knowledgeRoot, input });
        }
        case 'ingest-inbox':
            return runIngestInboxCommand({ knowledgeRoot });
        case 'query': {
            const question = rest.join(' ').trim();
            if (!question) {
                throw new Error('usage: llm-wiki query <knowledgeRoot> <question>');
            }
            return runQueryCommand({ knowledgeRoot, question });
        }
        case 'lint':
            return runLintCommand({ knowledgeRoot });
        case 'index':
            return runBuildIndexCommand({ knowledgeRoot });
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
            const question = rest.join(' ').trim();
            if (!question) {
                throw new Error('usage: llm-wiki query-registry <registryRoot> <question>');
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
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
async function summarizeRequiredPaths(knowledgeRoot, relativePaths) {
    const present = [];
    const missing = [];
    for (const relativePath of relativePaths) {
        const targetPath = path.join(knowledgeRoot, relativePath);
        if (await exists(targetPath)) {
            present.push(relativePath);
        }
        else {
            missing.push(relativePath);
        }
    }
    return { present, missing };
}
async function readJobCounts(jobStorePath) {
    try {
        const raw = await readFile(jobStorePath, 'utf8');
        const parsed = JSON.parse(raw);
        const counts = {};
        for (const job of Object.values(parsed.jobs ?? {})) {
            if (!job.status) {
                continue;
            }
            counts[job.status] = (counts[job.status] ?? 0) + 1;
        }
        return counts;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}
async function exists(targetPath) {
    try {
        await access(targetPath);
        return true;
    }
    catch {
        return false;
    }
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
