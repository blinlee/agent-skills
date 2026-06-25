import { firstFlag, parseCliFlags, parseQueryArgs } from './flags.js';
const REGISTRY_ARGV_COMMANDS = new Set([
    'registry-init',
    'registry-list',
    'registry-add',
    'route',
    'route-inbox',
    'bridge-index',
    'bridge-list',
    'bridge-targets',
    'bridge-accept',
    'bridge-create-landing',
    'bridge-reject',
    'route-accept',
    'query-registry',
    'intake-scan',
    'intake-status',
    'intake-next',
    'intake-complete',
    'intake-reject',
    'intake-park',
    'profile-suggest',
    'profile-accept',
    'profile-reject',
    'profile-review',
]);
export function isRegistryArgvCommand(command) {
    return REGISTRY_ARGV_COMMANDS.has(command);
}
export async function runRegistryArgvCommand(input) {
    const { command, registryRoot, rest, handlers } = input;
    switch (command) {
        case 'registry-init':
            return handlers.runRegistryInitCommand({ registryRoot });
        case 'registry-list':
            return handlers.runRegistryListCommand({ registryRoot });
        case 'registry-add': {
            const hasExplicitWikiRoot = Boolean(rest[0]) && !rest[0].startsWith('--');
            const wikiRoot = hasExplicitWikiRoot ? rest[0] : undefined;
            const flagArgs = hasExplicitWikiRoot ? rest.slice(1) : rest;
            const flags = parseCliFlags(flagArgs);
            const id = firstFlag(flags, 'id');
            if (!id) {
                throw new Error('registry-add requires --id <wikiId>');
            }
            return handlers.runRegistryAddCommand({
                registryRoot,
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
            return handlers.runRouteCommand({ registryRoot, source });
        }
        case 'route-inbox':
            return handlers.runRouteInboxCommand({ registryRoot });
        case 'bridge-index':
            return handlers.runBridgeIndexCommand({ registryRoot });
        case 'bridge-list':
            return handlers.runBridgeListCommand({ registryRoot });
        case 'bridge-targets': {
            const [proposalId] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki bridge-targets <registryRoot> <proposalId>');
            }
            return handlers.runBridgeTargetsCommand({ registryRoot, proposalId });
        }
        case 'bridge-accept': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki bridge-accept <registryRoot> <proposalId> --target <wikiId>/<section>/<slug> --reviewer <name> [--reason <reason>]');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const target = firstFlag(flags, 'target');
            if (!reviewer) {
                throw new Error('bridge-accept requires --reviewer <name>');
            }
            if (!target) {
                throw new Error('bridge-accept requires --target <wikiId>/<section>/<slug>');
            }
            return handlers.runBridgeAcceptCommand({ registryRoot, proposalId, reviewer, target, reason: firstFlag(flags, 'reason') });
        }
        case 'bridge-create-landing': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki bridge-create-landing <registryRoot> <proposalId> --slug <slug> --reviewer <name> [--section bridges] [--reason <reason>]');
            }
            const flags = parseCliFlags(flagArgs);
            const reviewer = firstFlag(flags, 'reviewer');
            const slug = firstFlag(flags, 'slug');
            if (!reviewer) {
                throw new Error('bridge-create-landing requires --reviewer <name>');
            }
            if (!slug) {
                throw new Error('bridge-create-landing requires --slug <slug>');
            }
            return handlers.runBridgeCreateLandingCommand({
                registryRoot,
                proposalId,
                reviewer,
                slug,
                section: firstFlag(flags, 'section'),
                reason: firstFlag(flags, 'reason'),
            });
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
            return handlers.runBridgeRejectCommand({ registryRoot, proposalId, reviewer, reason });
        }
        case 'route-accept': {
            const [proposalId, ...flagArgs] = rest;
            if (!proposalId) {
                throw new Error('usage: llm-wiki route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>] --quality <quality.json> --curation <curation.json>');
            }
            const flags = parseCliFlags(flagArgs);
            return handlers.runRouteAcceptCommand({
                registryRoot,
                proposalId,
                wikiId: firstFlag(flags, 'wiki'),
                reviewer: firstFlag(flags, 'reviewer'),
                qualityPath: firstFlag(flags, 'quality'),
                curationPath: firstFlag(flags, 'curation'),
            });
        }
        case 'query-registry': {
            const queryOptions = parseQueryArgs(rest);
            if (!queryOptions.question) {
                throw new Error('usage: llm-wiki query-registry <registryRoot> <question> [--reading-mode <passage|document>] [--full]');
            }
            return handlers.runQueryRegistryCommand({
                registryRoot,
                question: queryOptions.question,
                readingMode: queryOptions.readingMode,
            });
        }
        case 'intake-scan':
            return handlers.runIntakeScanCommand({ registryRoot });
        case 'intake-status':
            return handlers.runIntakeStatusCommand({ registryRoot });
        case 'intake-next':
            return handlers.runIntakeNextCommand({ registryRoot });
        case 'intake-complete': {
            const [itemId, ...flagArgs] = rest;
            if (!itemId) {
                throw new Error('usage: llm-wiki intake-complete <registryRoot> <itemId> [--reviewer <name>]');
            }
            const flags = parseCliFlags(flagArgs);
            return handlers.runIntakeCompleteCommand({ registryRoot, itemId, reviewer: firstFlag(flags, 'reviewer') });
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
            return handlers.runIntakeRejectCommand({ registryRoot, itemId, reviewer, reason });
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
            return handlers.runIntakeParkCommand({ registryRoot, itemId, reviewer, reason });
        }
        case 'profile-suggest': {
            const flags = parseCliFlags(rest);
            return handlers.runProfileSuggestCommand({
                registryRoot,
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
            return handlers.runProfileAcceptCommand({ registryRoot, proposalId, reviewer, reason: firstFlag(flags, 'reason') });
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
            return handlers.runProfileRejectCommand({ registryRoot, proposalId, reviewer, reason });
        }
        case 'profile-review':
            return handlers.runProfileReviewCommand({ registryRoot });
        default:
            throw new Error(`unknown registry command: ${command}`);
    }
}
