# llm-wiki

面向 CLI 的 Markdown 知识库编译器，用来构建**有人审、有证据、兼容 Obsidian** 的 llm-wiki 知识库。

llm-wiki 适合这样的人：想把来源材料沉淀成耐久知识层，但又不想把所有内容都粗暴塞进一个没人审核的大杂烩笔记库里。它会把可读输入转成结构化 Markdown Wiki，同时保留原始材料证据、内部 review 面、taxonomy proposal、可查询页面，以及可选的多 wiki registry 管理能力。

## 它解决什么问题

很多“AI 知识库”方案最后都会坏在两件事上：

1. 太松，生成内容逐渐脱离原始证据
2. 太大，所有主题都被扔进一个被污染的超级仓

llm-wiki 反过来做：

- 原始材料保留为证据
- 生成结构保持可审核
- taxonomy 和路由决策默认有人审
- 一个超大总库不是前提，而是可选项

## 这个仓库包含什么

- **CLI 编译器**：初始化、摄入、查询、lint、建索引、维护 wiki root
- **Registry 工作流**：在一个 registry 下管理多个彼此隔离的 wiki
- **人工审核面**：taxonomy、route、profile creation、bridge decision 都是可审核 proposal
- **OpenClaw skill 合同层**：位于根目录 `SKILL.md`
- **TypeScript 实现与测试**：真正的持久核心在这里
- **`AGENTS.md` 贡献说明**：给 agent-assisted 开发者看的维护指引

## 核心概念

### Knowledge root

knowledge root 是通过 `init` 创建出来的一个有边界的 wiki 工作区，里面包括：

- wiki 页面与 schema 文件
- 原始材料 intake 和 manifest
- 内部 review / taxonomy proposal 状态
- system index 与日志

### Registry root

registry root 用来管理多个有边界的 wiki，而不是强迫所有内容共用一个库。适合主题应彼此隔离、但又希望通过统一操作层来查询和治理的场景。

### Human-governed proposals

llm-wiki 默认把模型生成的分类建议、路由建议、taxonomy 变更、bridge link、profile 建议都视为 **proposal**，而不是自动真理。Inbox / govern 工作流负责把这些决策提交给人审；不存在一个会悄悄物化 proposal 的独立公开 review pass。

## 环境要求

| 项 | 版本 / 要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 22 | TypeScript CLI 与测试工具链所需 |
| npm | 建议较新版本 | 用于安装、构建、测试 |
| Git | 建议安装 | 方便管理项目和生成的 wiki root |

运行核心 CLI 不需要数据库服务、向量库，也不要求本机安装 Obsidian。

## 安装

```bash
npm install
```

## 构建

```bash
npm run build
```

## 测试

```bash
npm test
```

## 快速开始

### Agent 工作流触发词

当从本仓库根目录作为 skill 使用时，llm-wiki 暴露五个稳定的用户工作流：

| 触发词 | 用途 |
| --- | --- |
| `/llm-wiki setup` | 连接或初始化本地 knowledge root / registry root。若没有已知 root，agent 需要询问路径，并可按用户确认保存为本机默认。 |
| `/llm-wiki inbox` | 检查 `raw/inbox`，先解码非 Markdown 投递物，再摄入或路由新材料，当场给出本批次的归档/连接决策，并只执行已批准的接受、拒绝、暂存或改派动作。 |
| `/llm-wiki query <question>` | 基于当前 wiki 或 registry 做带引用的问答。skill 会先跑 `scripts/query_handoff.py`，再执行返回的 `query` 或 `query-registry` 命令。 |
| `/llm-wiki maintain` | 运行 `status`、`lint`、`index` 等健康与新鲜度检查。 |
| `/llm-wiki govern` | 管理 registry 成员、profile 边界、taxonomy、bridge 和 routing policy。 |

这些是覆盖 CLI 命令的 skill 级工作流合同，不是独立的 TypeScript 子命令。

运行态 CLI 使用随仓库提交的编译入口 `dist/src/cli.js`。因此 `npm run --silent cli -- ...`
不需要全局 `tsx`；只有开发、重建或跑测试时才需要安装 Node 依赖。

skill 按以下顺序解析本地目标 root：

1. 用户请求里的显式路径
2. `llm_wiki_root`
3. `scripts/root_config.py` 管理的本机本地配置
4. 若仍不存在，则询问用户 root 路径以及是否保存为本机默认

保存的默认值是 agent 共享的本机状态。`scripts/root_config.py set` 仅在显式设置 `$llm_wiki_config` 时写入该覆盖路径；否则写入稳定的用户级 canonical 路径，例如 Unix/macOS 下的 `~/.config/llm-wiki/config.json`，或 Windows 下的 `%APPDATA%/llm-wiki/config.json`。`show` 还会兼容读取 `$XDG_CONFIG_HOME/llm-wiki/config.json` 和 macOS Application Support。默认值不会提交到本仓库。

### 1）初始化一个 knowledge root

```bash
npm run --silent cli -- init ./knowledge
```

### 2）摄入一个来源文件

```bash
npm run --silent cli -- ingest ./knowledge ./tests/fixtures/inputs/sample.md
```

或者把 inbox 里当前待处理的内容一起 ingest：

```bash
npm run --silent cli -- ingest-inbox ./knowledge
```

### 3）查询 wiki

```bash
npm run --silent cli -- query ./knowledge "What is Compiler Notes?"
```

### 4）对 wiki 跑 lint

```bash
npm run --silent cli -- lint ./knowledge
```

### 5）构建本地索引

```bash
npm run --silent cli -- index ./knowledge
```

### 6）查看 readiness 和 job 状态

```bash
npm run --silent cli -- status ./knowledge
```

## 多 wiki registry 工作流

如果你不想把所有内容塞进一个总库，可以用 registry 模式。

### 初始化 registry

```bash
npm run --silent cli -- registry-init ~/my-wikis
```

### 添加一个 wiki profile

```bash
npm run --silent cli -- registry-add ~/my-wikis --id ai --title "AI Wiki" --scope "llm,agent,rag,deep learning"
```

### 查看已注册 wiki

```bash
npm run --silent cli -- registry-list ~/my-wikis
```

### 把新来源路由到合适的 wiki

```bash
npm run --silent cli -- route ~/my-wikis ~/Downloads/article.md
```

### 跨多个 wiki 查询

```bash
npm run --silent cli -- query-registry ~/my-wikis "What do my notes say about LoRA?"
```

## 非 Markdown 文档

核心 llm-wiki CLI 摄入 Markdown / 类文本来源。PDF、图片、Word、PowerPoint、Excel、EPUB/HTML、ZIP、音频、notebook 或其他文档类格式必须先使用已安装的 `/anything2md` skill 转出 Markdown 派生文件。

llm-wiki skill 在摄入或路由非 Markdown 投递物前执行这个流程：

1. 用 `python3 scripts/skill_discovery.py anything2md --json` 验证 `/anything2md` 已安装
2. 运行 `python3 scripts/decoder_handoff.py <root> <source> --anything2md-root <anything2mdSkillRoot>`
3. 执行返回的 `shellCommand`，该命令不会向 anything2md 传 `--knowledge-root`
4. 使用返回的 `decodedMarkdown` 继续正常的 llm-wiki ingest/route、审批、lint、index 流程

handoff 命令会把原始二进制、解码 Markdown、转换器 metadata 和抽取资产都放在 `raw/objects/<sha-prefix>/<sha>/...` 下。不要在 llm-wiki root 里创建或使用顶层 `<root>/anything2md/` 目录；那是 anything2md 独立归档模式的布局，不属于 llm-wiki。

## 命令面

当前 CLI 主要有两组命令：

### Knowledge-root 命令

- `init`
- `ingest`
- `ingest-inbox`
- `query`
- `lint`
- `index`
- `taxonomy-list`
- `taxonomy-accept`
- `taxonomy-reject`
- `status`
- `save-synthesis`

### Registry 命令

- `registry-init`
- `registry-add`
- `registry-list`
- `intake-scan`
- `intake-status`
- `intake-next`
- `route`
- `route-inbox`
- `route-accept`
- `intake-complete`
- `intake-park`
- `intake-reject`
- `profile-suggest`
- `profile-accept`
- `profile-reject`
- `profile-review`
- `bridge-list`
- `bridge-accept`
- `bridge-reject`
- `bridge-index`
- `query-registry`

统一通过下面的方式调用：

```bash
npm run --silent cli -- <command> ...args
```

推荐保留 `--silent`，因为 CLI 会输出偏 JSON 的结果，npm 前缀噪音可能干扰解析。

## 仓库结构

```text
llm-wiki/
├── README.md
├── README.zh-CN.md
├── LICENSE
├── SKILL.md
├── package.json
├── scripts/
├── references/
├── evals/
├── src/
├── tests/
└── dist/
```

说明：

- `dist/` 是随仓库提交的 CLI 运行态产物；修改 TypeScript 后用 `npm run build` 重建
- `node_modules/` 默认 git ignore
- `SKILL.md`、`scripts/`、`references/` 是根目录 skill 表面
- `vendor/`、`.worktrees/`、`.omx/`、本地 `knowledge-*`、`review/` 都是本地态或参考面，默认 git ignore

## 设计立场

llm-wiki 对下面几件事是有明确立场的：

- 来源证据重要
- 生成结构应该可检查
- 路由与 taxonomy 应该可审核
- 多个有边界 wiki 往往比一个超级 wiki 更健康
- 持久状态变更应由 CLI/core 负责，而不是薄薄一层 agent 包装负责

## OpenClaw skill 边界

仓库里包含一个宿主中立的 skill 合同：`SKILL.md`。

skill 层故意做得很薄，真正持久的逻辑在 TypeScript CLI/core 里。这样这个项目既能作为直接 CLI 项目使用，也能作为 skill backend 使用。

六个 `/llm-wiki ...` 工作流、`/anything2md` 接线、本机 root 默认值和人工批准门都记录在这个 skill 合同里。

`AGENTS.md` 是给 agent-assisted 贡献者看的维护说明，普通 CLI 使用者可以忽略。

## 典型开发流程

```bash
npm install
npm test
npm run build
npm run --silent cli -- init /tmp/knowledge-demo
npm run --silent cli -- ingest /tmp/knowledge-demo ./tests/fixtures/inputs/sample.md
npm run --silent cli -- query /tmp/knowledge-demo "What is Compiler Notes?"
```

## 它不是什么

llm-wiki 不是：

- 托管式 SaaS 产品
- 模型分类建议的自动批准系统
- 人工策展的替代品
- “所有知识都该进一个总仓”的信仰工具

## License

MIT
