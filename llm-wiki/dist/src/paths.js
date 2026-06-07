import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const defaultKnowledgeLayout = [
    'raw/inbox',
    'raw/staged',
    'raw/archive',
    'raw/rejected',
    'raw/objects',
    'assets',
    'review/queue',
    'review/low-confidence',
    'review/conflicts',
    'review/merge-candidates',
    'taxonomy',
    'taxonomy/proposals',
    'taxonomy/evidence-proposals',
    'taxonomy/decisions',
    'taxonomy/disambiguation',
    'wiki/sources',
    'wiki/entities',
    'wiki/concepts',
    'wiki/syntheses',
    'wiki/comparisons',
    'wiki/queries',
    'wiki/reviews',
    'graph',
    'system/manifests',
    'system/jobs',
    'system/dedup',
    'system/adapters',
    'system/cache',
];
export const requiredKnowledgeFiles = [
    {
        relativePath: 'wiki/SCHEMA.md',
        initialContent: buildDefaultWikiSchema(),
    },
    {
        relativePath: 'wiki/index.md',
        initialContent: '# Wiki 索引\n',
    },
    {
        relativePath: 'wiki/log.md',
        initialContent: '# Wiki 日志\n',
    },
    {
        relativePath: 'system/jobs/jobs.json',
        initialContent: `${JSON.stringify({ jobs: {} }, null, 2)}\n`,
    },
    {
        relativePath: 'system/dedup/manifest.json',
        initialContent: `${JSON.stringify({ entries: {} }, null, 2)}\n`,
    },
    {
        relativePath: 'system/manifests/raw-sources.json',
        initialContent: `${JSON.stringify({ entries: {} }, null, 2)}\n`,
    },
    {
        relativePath: 'taxonomy/topic-registry.json',
        initialContent: `${JSON.stringify({ topics: [] }, null, 2)}\n`,
    },
    {
        relativePath: 'taxonomy/aliases.json',
        initialContent: `${JSON.stringify({ aliases: {} }, null, 2)}\n`,
    },
    {
        relativePath: 'taxonomy/category-graph.json',
        initialContent: `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`,
    },
    {
        relativePath: 'taxonomy/redirects.json',
        initialContent: `${JSON.stringify({ redirects: {} }, null, 2)}\n`,
    },
];
export function resolveKnowledgePaths(root) {
    const absoluteRoot = path.resolve(root);
    return {
        root: absoluteRoot,
        rawInbox: path.join(absoluteRoot, 'raw', 'inbox'),
        reviewQueue: path.join(absoluteRoot, 'review', 'queue'),
        reviewMergeCandidates: path.join(absoluteRoot, 'review', 'merge-candidates'),
        taxonomyDirectory: path.join(absoluteRoot, 'taxonomy'),
        topicRegistry: path.join(absoluteRoot, 'taxonomy', 'topic-registry.json'),
        taxonomyAliases: path.join(absoluteRoot, 'taxonomy', 'aliases.json'),
        taxonomyCategoryGraph: path.join(absoluteRoot, 'taxonomy', 'category-graph.json'),
        taxonomyRedirects: path.join(absoluteRoot, 'taxonomy', 'redirects.json'),
        wikiSources: path.join(absoluteRoot, 'wiki', 'sources'),
        wikiSchema: path.join(absoluteRoot, 'wiki', 'SCHEMA.md'),
        wikiIndex: path.join(absoluteRoot, 'wiki', 'index.md'),
        wikiLog: path.join(absoluteRoot, 'wiki', 'log.md'),
        wikiComparisons: path.join(absoluteRoot, 'wiki', 'comparisons'),
        wikiQueries: path.join(absoluteRoot, 'wiki', 'queries'),
        jobDirectory: path.join(absoluteRoot, 'system', 'jobs'),
        jobStore: path.join(absoluteRoot, 'system', 'jobs', 'jobs.json'),
        dedupDirectory: path.join(absoluteRoot, 'system', 'dedup'),
        dedupManifest: path.join(absoluteRoot, 'system', 'dedup', 'manifest.json'),
        rawManifest: path.join(absoluteRoot, 'system', 'manifests', 'raw-sources.json'),
    };
}
export async function ensureKnowledgeRootLayout(root) {
    const paths = resolveKnowledgePaths(root);
    await Promise.all(defaultKnowledgeLayout.map((entry) => mkdir(path.join(paths.root, entry), { recursive: true })));
    await Promise.all(requiredKnowledgeFiles.map((file) => ensureBootstrapFile(path.join(paths.root, file.relativePath), file.initialContent)));
    return paths;
}
async function ensureBootstrapFile(filePath, initialContent) {
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
        await access(filePath);
        return;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    await writeFile(filePath, initialContent, 'utf8');
}
function buildDefaultWikiSchema() {
    return [
        '# Wiki 结构说明',
        '',
        '## 目的',
        'llm-wiki 会把规范化的原始材料编译成可长期维护、可互链的 Markdown 知识资产。它是编译器式知识库，不是临时聊天记录，也不是只有数据库缓存的 RAG 层。',
        '',
        '## 分层',
        '- `raw/inbox/`: 给人投递新来源的短期入口。intake scan 应尽快把条目移出这里，避免定时 agent 翻历史 raw 文件。',
        '- `raw/objects/`: atlas 级原始材料的分片内容寻址对象库（`raw/objects/<sha-prefix>/<sha>/...`）。查待处理工作应使用 intake ledger，不要扫描这棵目录做决策。',
        '- `raw/staged/`、`raw/archive/`、`raw/rejected/`: 单 wiki 摄入时保存的不可变证据。受管 raw 文件在正文前带有 `source_ref`、`ingested`、`sha256` frontmatter。agent 可以读取，但采集后不得编辑；修正应写入 `wiki/`、`review/` 或 `taxonomy/`。',
        '- `wiki/`: 由编译器/skill 维护、面向人阅读且兼容 Obsidian 的知识页。',
        '- `review/`: 内部治理状态，用于低置信、冲突或可能需要合并的知识候选。',
        '- `taxonomy/`: topic、alias、redirect、disambiguation 和 category graph 的开放治理层。',
        '- `system/`: jobs、dedup manifest、raw-source manifest、cache、compile manifest 等机器状态。',
        '- `graph/`: 预留的图导出/schema 层。',
        '',
        '## 页面分区',
        '- `wiki/sources/`: 来源摘要和以 provenance 为核心的来源页。',
        '- `wiki/entities/`: 人、组织、产品、项目、模型、系统，或其他有稳定名称的实体。',
        '- `wiki/concepts/`: 概念、主题、技术、机制、想法和可复用解释。',
        '- `wiki/syntheses/`: 已提升为稳定资产的可复用问答或跨来源综合。',
        '- `wiki/comparisons/`: 预留的稳定对比分析页。',
        '- `wiki/queries/`: 值得保留但尚未提升为更强综合的查询结果。',
        '',
        '## 约定',
        '- 使用 lowercase kebab-case slug。',
        '- 优先使用带分区的 wikilink：`[[sources/source-slug|Title]]`、`[[entities/entity-slug|Title]]`、`[[concepts/concept-slug|Title]]`、`[[syntheses/synthesis-slug|Title]]`。',
        '- 稳定页面应写入 `wiki/index.md` 的正确分区。',
        '- 有意义的动作应追加到 `wiki/log.md`。',
        '- 证据允许时，稳定 entity/concept/synthesis 页应尽量至少有两个出站链接。',
        '- 页面正文或 metadata 应保留 provenance。弱断言应保持低置信状态或进入内部治理状态。',
        '- 每个稳定页面都应带 frontmatter（`title`、`created`、`updated`、`type`、`tags`、`sources`、`confidence`、`contested`），方便 lint 暴露过期、薄弱或有争议的知识。',
        '- 当 synthesis 跨多个来源时，应使用 source ref、artifact ID 或 `^[raw/... ]` 风格 provenance 标记引用 raw 证据。',
        '',
        '## 页面阈值',
        '- 只有候选项被接受后才创建稳定 entity/concept 页；中心性和重复证据只能证明需要提案，不能静默物化。',
        '- 不要为路过式提及创建稳定页面。',
        '- 同一稳定主题应更新既有页面，不要重复建页。',
        '- 页面长到难以快速扫描时，应拆分或重构。',
        '- 候选、 uncertain、conflicting 或 merge-prone 的知识应进入内部治理状态，不要静默固化。',
        '- 已接受 topic 的新证据应先进入 taxonomy evidence proposal，不要让普通 ingest 静默改写已接受 concept 页。',
        '',
        '## 人在回路分类',
        '- 模型生成的来源分类、taxonomy placement、entity merge、concept assignment、tag 和目标文件夹，在人接受或编辑前都只是提案。',
        '- 未批准分类可用于临时路由、daily brief 和内部治理队列，但不能成为 canonical taxonomy 或稳定归档位置。',
        '- High model confidence is not approval。分类治理默认策略是 `require_human_review_by_default: true`。',
        '- 已接受分类应记录 reviewer identity、review time、confidence、rationale 和 source evidence。',
        '',
        '## 质量信号',
        '- `confidence: high | medium | low` 可用于 frontmatter 或内部治理记录。',
        '- 断言冲突时应使用 `contested: true` 和 contradiction notes。',
        '- 单来源或快速变化的断言应避免虚假确定性。',
        '',
        '## Lint 预期',
        '- 重新计算每个受管 raw 文件的 sha256，并与 frontmatter 和 `system/manifests/raw-sources.json` 比较，以检测 raw source drift。',
        '- 检测断开的 wikilink。',
        '- 检测无法从索引或其他页面到达的 orphan page。',
        '- 检查稳定 wiki 页面是否完整进入索引。',
        '- 暴露 low-confidence、contested、stale、oversized 或 taxonomy-drift 页面，供维护和治理处理。',
        '- 当 index section 超过规模阈值，或大型 wiki 缺少 topic map/RAG-friendly retrieval surface 时发出警告。',
        '',
    ].join('\n');
}
