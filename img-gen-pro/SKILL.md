---
name: img-gen-pro
user-invocable: true
description: 面向 GPT Image 2 的图像生成 / 编辑技能。当用户提到做图、出图、生成图片、做海报、做信息图、做 UI 样机、做产品图、做头像、做漫画、做分镜、做技术架构图、做品牌设计、做包装、做地图、做 PPT、编辑图片、换背景、去水印、修图、P 图、画一张、配图、设计封面、参考图复刻、图片二次开发等图像相关需求时，都应触发此技能。不要裸写 prompt——本技能先用 routing brief 区分视觉意图、用途、版式、风格与内容负载，再使用 110+ canonical 模板（17 个 references 目录）+ 13 个 retrieval categories + 28 个 template hubs 做分层收敛，并叠加 text QA gate 与参考图工作流。即使用户只说"帮我画一张图"，也应触发本技能做模板收敛。支持 4 种运行模式：(A) Garden 本地出图、(B) 委托宿主 Agent 出图、(C) Codex CLI 出图、(D) 纯 prompt 顾问。
---

# img-gen-pro

面向 GPT Image 2 的聚焦型图像生成 / 编辑技能。当前使用 110+ 个 canonical 模板（按 17 个 `references/` 目录组织），并通过 13 个 retrieval categories 与 28 个 template hubs 做模糊输入收敛，覆盖海报 / UI / 产品 / 信息图 / 学术图 / 技术架构图 / 漫画 / 头像 / 流程板 / 电影分镜 / IP 周边 / 编辑工作流等场景。

**核心工作流：先把用户输入拆成 routing brief，再做模板方向收敛（category -> style -> scene -> example cases），再组装 prompt，最后判断运行模式。**

> `build-prompt.mjs` 当前采用 **routing-brief first**：先判断哪些信息适合参与模板匹配（视觉类型、用途、版式、风格），哪些信息应保留为内容负载或弱匹配信号（具体题材、公式、直播文字、架构节点、细节要求）。随后再把 routing brief 交给 Template Composer 形成 `primary / supporting / style / constraints` 组合计划；如果 composer 没有稳定、可信且存在的 primary canonical target，则改走 selector path 做单模板解析。

> **为什么先收敛模板再判断模式？** 模板方向决定 prompt 结构和所需槽位。如果先判断模式再选模板，prompt 质量会受模式探测噪声干扰。先确定"做什么图"再决定"怎么出图"，是更稳定的路径。

它只做两类图像任务：

- 生成图片：`POST /images/generations`
- 编辑图片：`POST /images/edits`

本文件保留：运行模式、技能结构、环境变量、保存 / 命名规则、模式感知工作流。详细模板全部放在 `references/`，分层组织：

- 一级：分类目录
- 二级：单模板 Markdown 文件

## Hybrid 检索优先工作流（Phase 1）

当用户输入比较模糊时，先按下面顺序缩小模板范围，再决定后续模式和交付方式：

0. **如果用户给了参考图，先由多模态 LLM 直接看图。**
   - 先提炼一个简短视觉摘要：主体 / 构图 / 镜头 / 风格 / 光线 / 色彩 / 文本密度 / 平台语法 / 明显材质或版式信号
   - 再提炼 `keep` / `change`：哪些视觉元素要保留，哪些地方是用户明确想改的
   - 不要承诺"逆推出原始 prompt / seed / 参数"；目标只是形成一个足够好的 **rebuild brief**
   - 这个 brief 是后续模板匹配与 prompt 标准化的输入，不是绕过模板库直接自由发挥
1. 先建立 routing brief：拆出 `visualTaskType / outputPurpose / layoutIntent / styleIntent / routingQuery / contentPayload / weakMatchTerms`
2. 由 Template Composer 使用 `routingQuery` 建立 `primary / supporting / style / constraints` 组合计划
3. `primary` 决定画面骨架；`supporting` / `style` 只能借兼容的结构、风格或约束，不能反客为主
4. 如果 composer 无法给出存在且可信的 `primary`，改走 selector path 做单模板解析，而不是硬上错误组合
5. 如果有参考图，把上面的视觉摘要一起作为匹配信号；必要时参考 example cases 与 prompt variants 做 disambiguation
6. **如果前两个方向都合理，但会导向不同的 prompt 结构，必须先问用户一个最小选择题**
   - 问题要描述**结果差异**，不能暴露内部模板名、文件路径或 template id
   - 例如问"你更想让标题字成为主角，还是让主体画面与构图成为主角？"
   - 如果一个方向明显更专、命中了专项 prompt / exact case，就直接选，不要多问
   > **为什么要问？** 不同方向的 prompt 结构差异大（比如"大字海报"和"产品主图"的布局逻辑完全不同），选错了用户必然不满。一个 5 秒的选择题省掉一次返工。
7. 最终落到 `references/` 里的 primary canonical Markdown，并保留本次参考的 supporting / style 模板类别
8. 完成 prompt 产出后，必须向用户说明本次参考了哪些模板类别（来自 `templateCategoryUserSummary` / `templateCategorySummary`）
9. 只有当 prompt 基本成型后，才判断运行模式（A / B / C / D）

routing brief 的边界：

- `routingQuery` 只表达视觉任务、用途、版式、媒介和风格，用来匹配模板。
- `contentPayload` 保留具体题材、公式、架构节点、直播文案、商品细节、必须出现元素，用来填最终 prompt。
- `weakMatchTerms` 可以作为辅助信号，但不能压过 `visualTaskType / outputPurpose / layoutIntent`。
- 当用户请求学术原理图、机制图、ER 图、拓扑图时，不要因为它们有标签和说明文字就当成 generic infographic。

### Prompt Builder（Phase 1.5）

模板方向确定后，不要直接裸写 prompt。最终 prompt 以 canonical 模板为骨架，只吸收兼容的结构信号、prompt fragments 与文本校验规则；prompt intelligence 可用于排序和诊断，但不能把匹配到的上游 prompt body 原文注入最终 prompt。

> **为什么不裸写？** 裸写 prompt 会丢失模板里的结构约束、文字校验规则、比例规范和 avoid 清单。100+ 模板是社区逆向提炼的工业级结构，自由发挥的质量远不如模板驱动。

这里的重点是**工作流规范**，不是"先跑某个脚本"：

- 先确定这次是普通文生图，还是"参考图复刻 / 参考图二次开发"
- 如果有参考图，先让多模态 LLM 看图并形成 rebuild brief，再回到同一条模板匹配主链
- 选定 canonical 模板后，再补槽位、补平台语法、补 layout / hierarchy、补 avoid
- 最终产出 generation-ready prompt，而不是停在"模板名选出来了"

builder 的职责：

- 选定 canonical 模板后，拼出 generation-ready prompt draft
- 基于当前模板、query 和 detector 结果，识别最多 1~2 个高影响补槽问题（不是问模板名）
- 标记 text-bearing 风险与 inspection zones
- 在参考图模式下把 visual brief / keep-change note 重新并回主链
- 保留用户具体内容到最终 prompt，但不要让无关 prompt variant body 覆盖当前模板语义

运行时契约：
- canonical template 可以是 JSON-first，也可以是结构化模板说明；这只影响模板来源，不影响最终交付格式
- builder 内部必须渲染出一个**内容为标准 JSON 的 prompt string**
- 当前 Mode A / B / C / D 的最终 handoff 统一是 **JSON prompt string**
- 也就是说：最终交给图像模型的 prompt 文本本身必须能被 `JSON.parse` 解析；不得在 JSON 外追加自然语言段落

**重要：如果存在方向冲突或关键槽位待澄清，必须先停下并问用户，不得直接继续出 prompt / 生图。**
- 方向冲突：抛一个最小选择题，让用户在两种结果之间选
- 关键槽位缺失：抛字段级选择题 / 简短问题
- 只有当用户明确说“你先默认来一版 / 你替我定 / 先出第一版”时，才允许带默认值继续

### 参考图工作流（LLM 在环）

当用户说"参考这张图 / 按这个来 / 大体复刻 / 照这个版式做一版 / 基于这张图二改"时，按下面流程：

1. **先看图，不先猜模板。**
   - 多模态 LLM 先直接分析图片里的主体、构图、景别、风格、材质、光线、排版、文本区域、平台或媒介特征。
2. **形成 rebuild brief。**
   - 用 3 组信息归纳：
     - `visible structure`：画面里客观能看到什么
     - `keep`：这次要保留什么
     - `change`：用户要改什么
3. **拿 rebuild brief 去模板库匹配。**
   - 看它更像 UI、产品主视觉、品牌板、海报、信息图、摄影、角色图还是别的方向
   - 仍然遵守"category -> style -> scene -> example cases"的收敛顺序
4. **如果有两个高匹配方向，就问一个结果导向的问题。**
   - 例如："你更想保留这张图的版式结构，还是只保留它的氛围 / 风格？"
   - 不要把内部模板名抛给用户
5. **回到 canonical 模板，产出标准化 prompt。**
   - rebuild brief 只是输入；最终 prompt 仍必须落到当前模板库的 canonical 结构里
6. **如果是带字图，再进入 text QA gate。**
   - 标题、价格、CTA、标签、评论区、信息图 label 等必须被单独检查

一句话原则：**参考图不是旁路；它只是给模板匹配和 prompt 标准化提供更强的视觉输入。**

### Schema 边界（强约束）

- `data/retrieval-index.json` 是 **metadata / retrieval schema**
- `references/` 中的模板是 **prompt-instance schema**
- 不允许把检索索引中的模板条目直接硬套成 canonical 模板的 prompt JSON
- 索引 → canonical 模板只能通过 `data/template-crosswalk.json` 这类 projection / adapter 完成

### 编辑任务也走标准化工作流（Phase 1）

如果任务是"保留原图主体，只做局部修改 / 去除 / 换背景 / 精修"，不要直接裸写 edit prompt。先做编辑工作流收敛：

1. 运行 `scripts/select-edit-workflow.mjs`
2. 在 `references/editing-workflows/` 中收敛到正确的编辑模板
3. 按模板里的缺失信息优先提问顺序补齐关键字段
4. 再把最终 prompt 交给 `scripts/edit.js`（Mode A）或宿主图片编辑工具（Mode B）

示例：

```bash
node scripts/select-edit-workflow.mjs --query "保留产品，只把背景换成极简影棚"
node scripts/select-edit-workflow.mjs --query "去掉背景里的路人" --json
```

## 运行模式（在模板方向明确后再确定）

当你准备实际调用本地脚本时，再跑这个轻量探测脚本：

```bash
node scripts/check-mode.js
# 想拿结构化结果给上层程序用：
node scripts/check-mode.js --json
```

输出会给出 `mode = A` / `A?` / `B` / `C` / `D` 以及 `recommendation`。四个正式模式定义如下：

### Mode A · Garden 本地生图

**触发条件**：环境变量 `ENABLE_GARDEN_IMAGEGEN` 为真（`1` / `true` / `yes` / `on`）**且** 存在 `OPENAI_API_KEY`。

**行为**：完整端到端跑通"选模板 → 写 prompt → 调用脚本 → 出图落盘"。

- 用 `scripts/generate.js` 文本生图、`scripts/edit.js` 编辑现有图。
- prompt 默认落盘到 `img-gen-pro/prompt/`、图片落盘到 `img-gen-pro/image/`。
- 这是最强的模式：你是图像工具的"持有者"。

### Mode B · Host-Native 委托宿主出图

**触发条件**：未启用 Garden（`ENABLE_GARDEN_IMAGEGEN` 未设置 / 为假），但**当前宿主 Agent 自带图像生成工具或图像 MCP**。

**典型识别信号**（你应该自检）：

- 你的工具集里出现 `image_generation` / `imagegen` / `dalle` / `nano_banana` / `mcp__*image*` / `make_image` / 类似名字
- 用户在 ChatGPT / Codex / Gemini / Cursor 等支持原生出图的客户端中调用本 Skill
- 用户显式说"用你自己的工具出图"

**行为**：本 Skill **退化成提示词工程指引**——

1. 仍按"选模板 → 填字段 → 渲染最终 prompt"的流程走。
2. **不要调用 `node scripts/generate.js`**（没有 API key、必失败）。
3. 直接调用宿主自带的图像工具，把渲染好的 prompt 作为输入。
4. 如用户希望可顺手把 prompt 文件保存到 `img-gen-pro/prompt/`，但图片去向由宿主决定，不强制。

### Mode C · Codex CLI 出图

**触发条件**：未启用 Garden、宿主也没有原生图像工具，但 **Codex CLI 可用**。

**行为**：本 Skill 继续复用当前 prompt 主链，只把最终执行换成 Codex CLI render backend——

1. 仍按"选模板 → 填字段 → 渲染最终 prompt"的流程走。
2. 用 `scripts/prepare-codex-render.mjs` 把 JSON prompt string 准备成 render plan。
3. 真正执行时，**必须通过 OpenClaw `exec(pty=true)` 跑 `codex exec`**。
4. **`codex -o` 只保存最后一条 assistant message**，不是完整 transcript；不要误当成完整会话记录。
5. **默认先落本地，不自动回聊天**。先让主控 / 人类看 render 结果，再决定是否发送或继续迭代。

### Mode D · Advisor 纯提示词顾问

**触发条件**：未启用 Garden，宿主 Agent 没有图像生成工具，**且** Codex CLI 也不可用。

**行为**：本 Skill 退化为"高质量 prompt 撰写顾问"——

1. 按"选模板 → 填字段 → 渲染最终 prompt"流程走，缺信息就问用户。
2. 把最终 prompt **直接打印给用户** + 保存一份到 `img-gen-pro/prompt/<task-slug>-<timestamp>.md`。
3. 附一句简短的"如何使用"建议（如：丢进 ChatGPT / Midjourney / DALL·E / Sora / Nano Banana / 自己后端 / 第三方 GPT Image 2 网关）。
4. **不要假装出图成功**。明确告知用户："已生成可直接复用的高质量 prompt，请用你的图像工具执行。"

### 模式决策表

| 条件 | 模式 | 调用脚本？ | 落盘 prompt？ | 落盘图片？ |
|---|---|---|---|---|
| `ENABLE_GARDEN_IMAGEGEN=1` + 有 KEY | **A** | ✅ `generate.js` / `edit.js` | ✅ 自动 | ✅ 自动 |
| `ENABLE_GARDEN_IMAGEGEN=1` 但没 KEY | A? | ❌（先要 KEY） | — | — |
| 未启用 + 宿主有图像工具 | **B** | ❌（用宿主工具） | 可选 | 由宿主决定 |
| 未启用 + 宿主无图像工具 + Codex CLI 可用 | **C** | ✅ `prepare-codex-render.mjs` + OpenClaw `exec(pty=true)` | ✅ 必须 | ✅ 本地先落盘 |
| 上述都不满足 | **D** | ❌ | ✅ 必须 | ❌（无法） |

### 任务收尾

无论哪种模式，任务结束后用一句话告诉用户：当前模式是什么、prompt 落在哪、图（如有）落在哪。

### 模式不确定时

- 如果你判断不清自己是 B / C / D 的哪一种，先查运行环境，再决定是否需要问用户。
- Mode A 调脚本失败（401 / 网络 / 配额）→ 报错并询问"切到 B / C / D 吗？"

## 用户输入工具

当此技能需要向用户提问时，遵循以下规则：

1. 优先使用当前运行时提供的用户输入工具。
2. 如果没有对应工具，则用简短的纯文本编号问题提问。
3. 能合并的问题尽量一次问完。

## 技能结构

- `scripts/check-mode.js`：在准备实际调用本地脚本时使用，用于检测运行模式（A / B / C / D）
- `scripts/check-codex-route.mjs`：检测 Codex CLI 是否可用
- `scripts/analyze-routing-intent.mjs`：输出 routing brief，用于检查哪些信息参与模板匹配、哪些保留为内容负载
- `scripts/routing-brief.mjs`：routing brief 的共享实现，供 builder / composer / selector 复用
- `scripts/generate.js`：文本生图（仅 Mode A 使用）
- `scripts/edit.js`：基于原图 / 遮罩改图（仅 Mode A 使用）
- `scripts/prepare-codex-render.mjs`：把 JSON prompt string 准备成 Codex render plan（仅 Mode C 使用）
- `scripts/run-codex-render.mjs`：Mode C 端到端执行器，负责落 prompt、准备 instruction、调用 Codex CLI、校验图片与写 result artifact
- `scripts/shared.js`：共享请求、保存、环境变量读取逻辑
- `scripts/select-template.mjs`：基于检索索引做 fuzzy-input → candidate template ranking
- `scripts/select-edit-workflow.mjs`：基于编辑工作流模板做 fuzzy edit-intent → editing workflow ranking
- `scripts/template-brief.mjs`：把候选模板落到具体 canonical 模板，并提取提问顺序 / 首个 JSON 模板
- `scripts/build-prompt.mjs`：把 canonical 模板 + prompt intelligence + prompt fragments 组合成最终 prompt 草稿
- `scripts/reference-rebuild.mjs`：参考图辅助整理工具；真正的图像理解应由多模态 LLM 在对话内完成
- `references/`：分层结构化提示词模板（A / B / C / D 四模式都用）
- `references/template-index.md`：完整模板分类目录与选择策略

## 环境变量

按以下顺序读取配置：

1. CLI 参数
2. `process.env`
3. `<cwd>/.env`
4. `<cwd>/.gateway.env`
5. `~/.gateway.env`

核心变量：

- `ENABLE_GARDEN_IMAGEGEN` — **模式开关**。`1` / `true` / `yes` / `on` 时启用 Mode A；未设置或其它值则进入 Mode B / C / D。
- `OPENAI_API_KEY` — Mode A 必需；B / C / D 不需要。
- `OPENAI_BASE_URL` — 默认 `https://api.openai.com/v1`，可指向第三方兼容网关。
- `OPENAI_IMAGE_MODEL` — 默认 `gpt-image-2`，可换成网关支持的型号（如 `gpt-image-1` / `dall-e-3`）。

默认实现按 OpenAI 兼容接口工作，不写死任何第三方网关。

## 默认输出目录

如果用户没有明确指定输出路径，统一使用当前工作区下的：

- 提示词目录：`img-gen-pro/prompt/`（**A / B / C / D 四种模式都建议用**，方便复用与版本管理）
- 图片目录：`img-gen-pro/image/`（**Mode A / C 使用**；Mode B 由宿主决定，Mode D 不产生图）

如果目录不存在，脚本（Mode A / C）必须自动创建；Mode B / D 在写 prompt 前手动 `mkdir -p`。

## 默认命名规则

如果用户没有明确指定文件名，脚本应自动生成与当前任务相关的文件名，并追加当前时间戳，避免重名。

命名规则：

- 提示词：`img-gen-pro/prompt/<task-slug>-<timestamp>.md`
- 图片：`img-gen-pro/image/<task-slug>-<timestamp>.png`

其中：

- `<task-slug>`：根据当前用户要求自动提取一个相关短名称
- `<timestamp>`：当前时间戳，例如 `20260424-153045`

示例：

- `img-gen-pro/prompt/live-commerce-ui-20260424-153045.md`
- `img-gen-pro/image/live-commerce-ui-20260424-153045.png`

## Prompt 保存规则

| 模式 | 是否必须保存 prompt | 说明 |
|---|---|---|
| Mode A | ✅ 必须 | 进入实际生成 / 编辑流程必落盘 |
| Mode B | 推荐 | 默认建议保存方便复用；用户说"不用"就略过 |
| Mode C | ✅ 必须 | Codex render 前必须把 prompt 固化为本地文件与 render plan |
| Mode D | ✅ 必须 | 用户拿走 prompt 自己执行，不落盘等于白干 |

通用规则（适用三种模式）：

1. 如果用户显式给了 prompt 文件路径，可直接使用该文件作为输入。
2. 如果用户直接给的是文本 prompt，也要先把最终 prompt 保存到 `img-gen-pro/prompt/`。
3. 如果用户显式指定了 `--prompt-output`，则尊重用户指定路径。
4. 否则使用默认命名规则自动保存。

## 图片保存规则（仅 Mode A）

1. 如果用户显式指定了 `--image` 或 `--output`，则尊重用户指定路径。
2. 否则默认保存到 `img-gen-pro/image/`。
3. 文件名应和当前任务语义相关，并附加时间戳。

Mode B 由宿主图像工具决定保存方式；Mode C 必须先落本地后再决定是否发送；Mode D 不产生图片.

## 快速用法

### 1. 先构建 prompt / 模板组合（推荐）

```bash
node scripts/analyze-routing-intent.mjs --query "ToF 激光雷达测距原理图，包含公式标注" --json
node scripts/build-prompt.mjs --query "做一个 AI 视频应用的落地页主视觉" --json
node scripts/build-prompt.mjs --query "做一张 RAG 技术详解信息图" --json
node scripts/compose-templates.mjs --query "顶级期刊论文里的系统架构图" --json
node scripts/select-edit-workflow.mjs --query "保留产品，只把背景换成极简影棚"
```

`build-prompt.mjs` 会统一输出 `primaryTarget`、`templateComposition`、`templateCategorySummary`、`templateCategoryUserSummary` 与最终 prompt。完成 prompt 后，对用户说明本次参考了哪些模板类别。

### 2. 检测运行模式（当你准备实际调用本地脚本时）

```bash
node scripts/check-mode.js
```

输出会告诉你当前是 Mode A / B / C / D，决定后续是否调用 `generate.js` / `edit.js` / Codex render plan。下面 3~6 仅在 **Mode A** 下使用。

### 3. 文本生图（Mode A）

```bash
node scripts/generate.js \
  --prompt "A cute baby sea otter" \
  --size 1024x1024 \
  --quality high
```

### 4. 用提示词文件生图（Mode A）

```bash
node scripts/generate.js \
  --promptfile img-gen-pro/prompt/poster-20260424-153045.md
```

### 5. 编辑已有图片（Mode A）

```bash
node scripts/edit.js \
  --image assets/source.png \
  --prompt "Replace the background with a clean studio scene"
```

### 6. 带遮罩的局部编辑（Mode A）

```bash
node scripts/edit.js \
  --image assets/source.png \
  --mask assets/mask.png \
  --prompt "Replace only the masked area with a glass vase"
```

### 7. Mode B / C / D 的"用法"

没有命令行入口——本 Skill 此时只是**提示词工程指南**：

- **Mode B**：渲染好最终 JSON prompt string → 调用宿主自带的 `image_generation` 类工具（参数中传入这段 JSON 字符串）→ 拿到图。
- **Mode C**：渲染好最终 JSON prompt string → 优先直接运行 `scripts/run-codex-render.mjs`（它内部会准备 plan、执行 Codex、校验落图、写 result artifact）→ 整个调用仍必须通过 OpenClaw `exec(pty=true)` 发起 → 图先落本地 → 再做人类 / 主控验收。
- **Mode D**：渲染好最终 JSON prompt string → 保存到 `img-gen-pro/prompt/<task-slug>-<timestamp>.md` → 把内容直接展示给用户 → 提示用户在哪些图像工具中可以直接复用。

## 模板工作方式（标准 JSON 最终交付）

当 `references/` 中提供 JSON 模板，或结构化模板说明时，按下面规则使用：

1. 先从 `SKILL.md` 找到最贴近的分类目录。
2. 再定位到具体模板文件。
3. 模板中的 `{argument ...}` 表示可替换参数；最终 JSON prompt string 不得保留未渲染的模板占位语法。
4. 用户明确提供的值，直接填入。
5. 用户没有提供，但模板标了 `default` 的，**不能直接继续**；先判断这是否属于关键槽位。
6. 如果缺失信息会显著影响结果，必须先询问用户；优先用选择题，不要闷头默认。
7. 只有当用户明确说"你随机生成"、"你先默认来一版"、"你替我定"时，才可以保留默认值或在模板允许范围内合理随机化。

补充说明：

- canonical 模板文件不必全部改写成 JSON；已有结构化模板说明可以作为来源继续存在。
- 但最终输出给图像模型的 prompt 必须是标准 JSON：JSON-first 模板按原结构渲染，非 JSON 模板转换为生成的 JSON 对象。
- 组合模板、avoid、文字检查、比例、平台和用户具体内容都必须进入 JSON 字段，不得以 JSON 外的自然语言尾巴追加。

## 询问规则

当模板缺少关键变量时，不要笼统地问"你想要什么风格？"。应当根据模板字段精确提问。

例如直播 UI 模板缺少主体时，应优先问：

- 主播是谁？
- 用真人照片、名人名字、人物描述，还是完全随机生成？

缺少商品信息时应问：

- 商品名称是什么？
- 商品价格是否指定？
- 是否希望我自动补全评论和礼物内容？

## 模板索引

按任务类型只读取最贴近的具体模板文件，不要一次性全读整个 `references/`。

完整分类目录与选择策略见 **`references/template-index.md`**。

方法论文档见 **`references/prompt-writing.md`**。

## 重要约束

通用：

- 模板文件中的 JSON 是**提示词结构模板**，不是 API 请求体模板；最终 prompt 仍作为字符串传给图像模型。
- 三种模式下，最终交给图像模型的都是"内容为标准 JSON 的 prompt 字符串"；禁止 JSON 外自然语言、Markdown 小标题或追加说明。
- 除非用户明确要求，否则**不要把 SKILL.md 里的"模式说明"复制到最终 prompt 里**——那是给 Agent 看的元信息。

仅 Mode A 适用：

- 生成脚本使用 JSON body
- 编辑脚本使用 multipart form data
- 响应优先按 `data[0].b64_json` 解析，也兼容 `data[0].url`
- 除非上游接口明确要求，不额外引入特殊 query 参数

## 何时提问

只在这些信息缺失且会显著影响结果时提问：

- 没有 prompt 目标
- 改图时没有原图
- 主体身份或视觉类型决定结果走向
- 商品 / 价格 / 文案 / UI 文本是画面核心组成部分
- 用户同时表达了多个互相冲突的目标

除此之外，优先自己做合理默认并继续执行。

## Gotchas

以下是本技能使用中最容易踩的坑，按频率排序：

- **不要跳过模板收敛直接裸写 prompt。** 没有 canonical 模板约束，模型会自由发挥导致排版崩坏、文字乱码、平台风格混搭。100+ 模板是社区逆向提炼的工业级结构，自由发挥质量远不如模板驱动。

- **带字图必须过 text QA gate。** GPT Image 2 对中文长句、小字号、密集标签的渲染不可靠。凡是画面里有用户指定文字的（标题、价格、CTA、弹幕、标签），必须在 prompt 中强制"文字必须精确显示为 [原文]，禁止乱码或占位文本"。

- **不要把检索索引 JSON 当 prompt 用。** `data/retrieval-index.json` 是 metadata / retrieval schema，不是 prompt 结构。必须落到 `references/` 里的 canonical 模板。

- **参考图不是旁路。** 用户给了参考图不代表可以跳过模板匹配。先看图 → rebuild brief → 回到模板主链 → 落到 canonical 模板 → 渲染 prompt。

- **内容负载不是模板方向。** 公式、架构节点、商品名、直播文案、化学/生物/物理细节通常应进入 `contentPayload` 和最终 prompt，不应直接主导模板匹配。先判断它要成为什么图，再填它讲什么内容。

- **不要逆推原始 prompt。** 参考图模式的目标是形成 rebuild brief（可见结构 + keep + change），不是逆向工程出原始 seed / 参数 / 完整 prompt。

- **问用户时不暴露内部名。** 不要把模板名、文件路径、template id 或任何历史内部来源叫法暴露给用户。问题要描述结果差异，例如"你更想让标题字成为主角，还是让画面构图成为主角？"

- **比例不要乱猜。** 用户没指定时，按任务类型推断（dashboard / 架构 / 学术图 → 16:9，直播 / 社交界面 → 9:16，信息图 → 3:4，产品转化图 → 4:5）。不要默认出 1:1。见 `scripts/prompt-compose-utils.mjs` 中的 `detectRatio` 逻辑。

- **Mode A 缺 KEY 时不要假装出图成功。** 检测到 `A?` 模式时，主动告诉用户需要配置 `OPENAI_API_KEY`，或询问是否切到 B / C / D。

- **Codex render 不要走 Python subprocess 套壳。** 真正的 `codex exec` 必须走 OpenClaw `exec(pty=true)`；`prepare-codex-render.mjs` 只负责生成 render plan，`run-codex-render.mjs` 负责端到端执行。
- **`codex -o` 不是 transcript。** 它只保存最后一条 assistant message，不能当完整会话日志或调试证据链。
- **Mode C 默认不自动回聊天。** 先落本地、先审图，再决定是否发送。

- **编辑任务也走模板。** 不要裸写 edit prompt。先选编辑模板（`references/editing-workflows/`），按缺失信息优先提问顺序补齐字段，再调用编辑脚本或宿主编辑工具。

- **脚本路径相对于技能根目录。** 所有 `scripts/*.mjs` 和 `scripts/*.js` 的调用都基于技能根目录，不是当前工作目录。用绝对路径或 `cd` 到技能根目录再执行。
