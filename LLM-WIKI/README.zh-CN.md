# LLM-WIKI

面向 CLI 的 Markdown 知识库编译器，用来构建**有人审、有证据、兼容 Obsidian** 的 LLM Wiki。

LLM-WIKI 适合这样的人：想把来源材料沉淀成耐久知识层，但又不想把所有内容都粗暴塞进一个没人审核的大杂烩笔记库里。它会把可读输入转成结构化 Markdown Wiki，同时保留原始材料证据、review 面、taxonomy proposal、可查询页面，以及可选的多 wiki registry 管理能力。

## 它解决什么问题

很多“AI 知识库”方案最后都会坏在两件事上：

1. 太松，生成内容逐渐脱离原始证据
2. 太大，所有主题都被扔进一个被污染的超级仓

LLM-WIKI 反过来做：

- 原始材料保留为证据
- 生成结构保持可审核
- taxonomy 和路由决策默认有人审
- 一个超大总库不是前提，而是可选项

## 这个仓库包含什么

- **CLI 编译器**：初始化、摄入、查询、lint、建索引、review wiki root
- **Registry 工作流**：在一个 registry 下管理多个彼此隔离的 wiki
- **人工审核面**：taxonomy、route、profile creation、bridge decision 都是可审核 proposal
- **OpenClaw skill 合同层**：位于 `skills/llm-wiki/`
- **TypeScript 实现与测试**：真正的持久核心在这里
- **`AGENTS.md` 贡献说明**：给 agent-assisted 开发者看的维护指引

## 核心概念

### Knowledge root

knowledge root 是通过 `init` 创建出来的一个有边界的 wiki 工作区，里面包括：

- wiki 页面与 schema 文件
- 原始材料 intake 和 manifest
- review / taxonomy 状态
- system index 与日志

### Registry root

registry root 用来管理多个有边界的 wiki，而不是强迫所有内容共用一个库。适合主题应彼此隔离、但又希望通过统一操作层来查询和治理的场景。

### Human-governed proposals

LLM-WIKI 默认把模型生成的分类建议、路由建议、profile 建议都视为 **proposal**，而不是自动真理。要由人来审和决定接不接受。

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
LLM-WIKI/
├── README.md
├── README.zh-CN.md
├── LICENSE
├── package.json
├── src/
├── tests/
├── skills/
└── dist/
```

说明：

- `dist/` 是构建产物，默认 git ignore
- `node_modules/` 默认 git ignore
- `vendor/`、`.worktrees/`、`.omx/`、本地 `knowledge-*`、`review/` 都是本地态或参考面，默认 git ignore

## 设计立场

LLM-WIKI 对下面几件事是有明确立场的：

- 来源证据重要
- 生成结构应该可检查
- 路由与 taxonomy 应该可审核
- 多个有边界 wiki 往往比一个超级 wiki 更健康
- 持久状态变更应由 CLI/core 负责，而不是薄薄一层 agent 包装负责

## OpenClaw skill 边界

仓库里包含一个宿主中立的 skill 合同：`skills/llm-wiki/SKILL.md`。

skill 层故意做得很薄，真正持久的逻辑在 TypeScript CLI/core 里。这样这个项目既能作为直接 CLI 项目使用，也能作为 skill backend 使用。

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

LLM-WIKI 不是：

- 托管式 SaaS 产品
- 模型分类建议的自动批准系统
- 人工策展的替代品
- “所有知识都该进一个总仓”的信仰工具

## License

MIT
