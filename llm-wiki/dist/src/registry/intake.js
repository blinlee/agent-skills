import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { runRegistryInit } from './state.js';
import { appendJsonLine } from './helpers.js';
import { resolveRegistryPaths } from './paths.js';
import { exists, readJsonFile, writeJsonFile } from '../shared/fs.js';
export async function runIntakeScan(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const entries = await readdir(paths.inboxDirectory, { withFileTypes: true });
    const discoveredItems = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() && !entry.isDirectory()) {
            continue;
        }
        if (entry.isFile() && isInboxControlSidecarName(entry.name)) {
            continue;
        }
        const sourcePath = path.join(paths.inboxDirectory, entry.name);
        const now = new Date().toISOString();
        const id = `src-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`;
        const sha256 = await hashIntakeSource(sourcePath);
        const objectPath = await moveInboxSourceToObjectStore({
            paths,
            sourcePath,
            fileName: entry.name,
            sha256,
        });
        const qualityPlanPath = await moveInboxControlSidecar({
            sourcePath,
            objectPath,
            extension: '.quality.json',
        });
        const curationPlanPath = await moveInboxControlSidecar({
            sourcePath,
            objectPath,
            extension: '.curation.json',
        });
        const item = {
            id,
            originalPath: path.relative(paths.root, sourcePath),
            currentPath: path.relative(paths.root, objectPath),
            objectPath: path.relative(paths.root, objectPath),
            qualityPlanPath: qualityPlanPath ? path.relative(paths.root, qualityPlanPath) : null,
            curationPlanPath: curationPlanPath ? path.relative(paths.root, curationPlanPath) : null,
            fileName: entry.name,
            sourceKind: entry.isDirectory() ? 'directory' : detectRouteSourceKind(entry.name),
            sha256,
            status: 'discovered',
            routeProposalId: null,
            targetWikiId: null,
            taxonomyProposalSlugs: [],
            wikiPages: [],
            managedRawArchive: null,
            reviewRequired: true,
            lastError: null,
            reviewer: null,
            reason: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            rejectedAt: null,
        };
        await writeIntakeItem(paths, item);
        await appendIntakeEvent(paths, { type: 'discovered', itemId: item.id, path: item.currentPath, objectPath: item.objectPath, createdAt: now });
        discoveredItems.push(item);
    }
    const pendingItems = (await readIntakeItems(paths))
        .filter((item) => !isTerminalIntakeStatus(item.status))
        .sort(compareIntakeItems);
    return {
        registryRoot: paths.root,
        inboxPath: paths.inboxDirectory,
        newCount: discoveredItems.length,
        pendingCount: pendingItems.length,
        action: pendingItems.length === 0 ? 'silent' : 'pending',
        discoveredItems,
        pendingItems,
    };
}
function isInboxControlSidecarName(name) {
    return name.endsWith('.curation.json') || name.endsWith('.quality.json');
}
export async function runIntakeStatus(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const items = (await readIntakeItems(paths)).sort(compareIntakeItems);
    const countsByStatus = {};
    for (const item of items) {
        countsByStatus[item.status] = (countsByStatus[item.status] ?? 0) + 1;
    }
    return {
        registryRoot: paths.root,
        pendingCount: items.filter((item) => !isTerminalIntakeStatus(item.status)).length,
        items,
        countsByStatus,
    };
}
export async function runIntakeNext(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    const scan = await runIntakeScan({ registryRoot: paths.root });
    const item = scan.pendingItems[0] ?? null;
    if (!item) {
        return {
            registryRoot: paths.root,
            action: 'silent',
            item: null,
            message: '没有新的或待处理的原始材料。定时任务可以安静退出。',
            suggestedCommand: null,
        };
    }
    const routeCommand = `llm-wiki route ${shellQuote(paths.root)} ${shellQuote(path.join(paths.root, item.currentPath))}`;
    const qualityArg = item.qualityPlanPath ? shellQuote(path.join(paths.root, item.qualityPlanPath)) : '<quality.json>';
    const curationArg = item.curationPlanPath ? shellQuote(path.join(paths.root, item.curationPlanPath)) : '<curation.json>';
    const acceptCommand = item.routeProposalId
        ? `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(item.routeProposalId)} --wiki <wiki-id> --reviewer <name> --quality ${qualityArg} --curation ${curationArg}`
        : null;
    if (item.status === 'discovered' || item.status === 'blocked') {
        return {
            registryRoot: paths.root,
            action: 'route-source',
            item,
            message: '先展示材料摘要和分类建议，人工确认后再收入。',
            suggestedCommand: routeCommand,
        };
    }
    if (item.status === 'route_proposed') {
        const proposal = item.routeProposalId
            ? await readJsonFile(path.join(paths.routingProposalsDirectory, `${item.routeProposalId}.json`), null)
            : null;
        if (proposal?.decisionType === 'create_new_wiki' && proposal.newWikiProposalId) {
            return {
                registryRoot: paths.root,
                action: 'profile-review',
                item,
                message: '这个材料没有强匹配的已有 wiki。请展示新 wiki 草稿，让人决定新建、暂存、拒收，或改放进已有 wiki。',
                suggestedCommand: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(proposal.newWikiProposalId)} --reviewer <name>`,
            };
        }
        return {
            registryRoot: paths.root,
            action: 'show-route-proposal',
            item,
            message: '展示推荐 wiki、候选 wiki 和理由，等待人工明确接受。',
            suggestedCommand: acceptCommand,
        };
    }
    if (item.status === 'route_accepted' || item.status === 'ingested' || item.status === 'taxonomy_review' || item.status === 'taxonomy_resolved' || item.status === 'indexed') {
        return {
            registryRoot: paths.root,
            action: 'continue-review',
            item,
            message: '继续完成待审核/索引检查，然后由明确审核人标记完成或拒收。',
            suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
        };
    }
    return {
        registryRoot: paths.root,
        action: 'complete-or-reject',
        item,
        message: '请明确完成或拒收这个 intake 项。',
        suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
    };
}
export async function runIntakeComplete(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer?.trim() || 'human';
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'completed',
        reviewer,
        reason: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }), 'completed');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
export async function runIntakeReject(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer.trim();
    const reason = input.reason.trim();
    if (!reviewer) {
        throw new Error('intake-reject requires --reviewer <name> after human review.');
    }
    if (!reason) {
        throw new Error('intake-reject requires --reason <reason>.');
    }
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'rejected',
        reviewer,
        reason,
        rejectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }), 'rejected');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
export async function runIntakePark(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer.trim();
    const reason = input.reason.trim();
    if (!reviewer) {
        throw new Error('intake-park requires --reviewer <name>.');
    }
    if (!reason) {
        throw new Error('intake-park requires --reason <reason>.');
    }
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'parked',
        reviewer,
        reason,
        reviewRequired: false,
        updatedAt: new Date().toISOString(),
    }), 'parked');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
async function moveInboxSourceToObjectStore(input) {
    const shard = input.sha256.slice(0, 2);
    const objectDirectory = path.join(input.paths.rawObjectsDirectory, shard, input.sha256);
    const objectPath = path.join(objectDirectory, input.fileName);
    await mkdir(objectDirectory, { recursive: true });
    if (await exists(objectPath)) {
        await rm(input.sourcePath, { recursive: true, force: true });
        return objectPath;
    }
    await rename(input.sourcePath, objectPath);
    return objectPath;
}
async function moveInboxControlSidecar(input) {
    const sidecarPath = await findInboxControlSidecar(input.sourcePath, input.extension);
    if (!sidecarPath) {
        return null;
    }
    const objectSidecarPath = `${input.objectPath}${input.extension}`;
    await mkdir(path.dirname(objectSidecarPath), { recursive: true });
    if (await exists(objectSidecarPath)) {
        await rm(sidecarPath, { force: true });
        return objectSidecarPath;
    }
    await rename(sidecarPath, objectSidecarPath);
    return objectSidecarPath;
}
async function findInboxControlSidecar(sourcePath, extension) {
    const parsed = path.parse(sourcePath);
    const candidates = [
        `${sourcePath}${extension}`,
        path.join(parsed.dir, `${parsed.name}${extension}`),
    ];
    for (const candidate of candidates) {
        if (await exists(candidate)) {
            return candidate;
        }
    }
    return null;
}
export async function readIntakeItems(paths) {
    const entries = await readdir(paths.intakeItemsDirectory, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const item = await readJsonFile(path.join(paths.intakeItemsDirectory, entry.name), null);
        if (item) {
            items.push(item);
        }
    }
    return items;
}
export async function readIntakeItem(paths, itemId) {
    return readJsonFile(intakeItemFile(paths, itemId), null);
}
export async function updateIntakeItem(paths, itemId, update, eventType) {
    const item = await readIntakeItem(paths, itemId);
    if (!item) {
        throw new Error(`Intake item does not exist: ${itemId}`);
    }
    const updated = update(item);
    await writeIntakeItem(paths, updated);
    await appendIntakeEvent(paths, {
        type: eventType,
        itemId,
        status: updated.status,
        updatedAt: updated.updatedAt,
    });
    return updated;
}
export async function writeIntakeItem(paths, item) {
    await writeJsonFile(intakeItemFile(paths, item.id), item);
}
export function intakeItemFile(paths, itemId) {
    return path.join(paths.intakeItemsDirectory, `${itemId}.json`);
}
export async function appendIntakeEvent(paths, value) {
    await appendJsonLine(paths.intakeEvents, value);
}
export async function findIntakeItemBySource(paths, source) {
    const sourcePath = path.resolve(source);
    const items = await readIntakeItems(paths);
    return items.find((item) => path.resolve(paths.root, item.currentPath) === sourcePath) ?? null;
}
export async function findIntakeItemByRouteProposal(paths, proposalId) {
    const items = await readIntakeItems(paths);
    return items.find((item) => item.routeProposalId === proposalId) ?? null;
}
export function compareIntakeItems(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
export function isTerminalIntakeStatus(status) {
    return status === 'completed' || status === 'rejected' || status === 'parked';
}
function detectRouteSourceKind(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
        return 'local-file';
    }
    return 'unknown';
}
async function hashIntakeSource(sourcePath) {
    const hash = createHash('sha256');
    const metadata = await stat(sourcePath);
    if (metadata.isDirectory()) {
        await hashDirectory(sourcePath, hash, sourcePath);
    }
    else {
        hash.update(await readFile(sourcePath));
    }
    return hash.digest('hex');
}
async function hashDirectory(root, hash, current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const absolutePath = path.join(current, entry.name);
        const relativePath = path.relative(root, absolutePath);
        hash.update(relativePath);
        if (entry.isDirectory()) {
            await hashDirectory(root, hash, absolutePath);
        }
        else if (entry.isFile()) {
            hash.update(await readFile(absolutePath));
        }
    }
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
