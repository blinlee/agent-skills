# img-gen-pro

用于图像生成、图像编辑和 prompt 组装的 GPT Image 2 技能与脚本工具集，并提供一层一等公民级的 OpenClaw 集成。

`img-gen-pro` 解决的是一个很实际的问题：**能走可复用工作流时，就不要每次从零瞎写图像 prompt。** 这个仓库把技能层工作约束、canonical 模板库、检索元数据和可运行脚本收在一起，既能给 agent 用，也能直接给命令行用。

## 这个仓库包含什么

- **OpenClaw skill 层**：`SKILL.md` 规定 agent 如何路由图像任务、如何澄清需求、如何选模板、如何决定运行模式。
- **canonical 模板库**：`references/` 下是可复用的图像任务模板，覆盖海报、UI、产品图、信息图、架构图、人像、编辑工作流等场景。
- **检索与组装数据**：`data/` 里放路由元数据、crosswalk、prompt intelligence 资产和 template-composer profiles。
- **可运行脚本**：`scripts/` 提供 prompt 组装、运行模式检测、生成、编辑和仓库巡检。
- **评测与开发辅助资产**：`evals/` 与 `.dev/` 放维护脚本和本地评测资产。

## 核心用途

`img-gen-pro` 支持两类直接 API 动作，以及一层更大的工作流能力：

1. **生成新图片**
2. **编辑已有图片**
3. **在生成/编辑之前，先把 prompt 做对**

适合这些场景：

- 你要一个 OpenClaw 图像技能
- 你要一套可复用的 GPT Image 2 prompt 体系
- 你要本地可脚本化的生图 / 修图流程
- 你不想把图像能力建立在一堆一次性 prompt 文件上

## 运行模式

技能会把任务路由到四种运行模式：

| 模式 | 触发条件 | 行为 |
| --- | --- | --- |
| A | `ENABLE_GARDEN_IMAGEGEN` 为真且 `OPENAI_API_KEY` 可用 | `img-gen-pro` 直接调用图像 API 生成或编辑 |
| B | 不走直连 API，但宿主 agent 自己有图像工具 | `img-gen-pro` 负责 prompt，宿主负责出图 |
| C | 没有宿主图像工具，但有 Codex CLI | `img-gen-pro` 负责 prompt，并准备 Codex CLI 出图路径 |
| D | 以上都不满足 | 只输出高质量 prompt |

## 环境要求

### 必需

| 项 | 版本 / 要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 22 | 全部脚本都基于现代 ESM Node |
| Git | 建议较新版本 | 仓库工作流和 doctor 脚本会用到 |

### 只在特定模式下需要

| 项 | 用于 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | Mode A | 直连图像 API 生图/编辑必需 |
| OpenAI 兼容图像接口 | Mode A | 默认是 `https://api.openai.com/v1` |
| Codex CLI | Mode C | 仅在你要走 Codex 渲染时需要 |
| OpenClaw 宿主图像工具 | Mode B | 可选，依赖宿主环境 |

## 环境变量

| 变量 | 是否必需 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 仅 Mode A 必需 | 无 | 图像 API 鉴权 |
| `OPENAI_BASE_URL` | 可选 | `https://api.openai.com/v1` | 覆盖图像 API 基础地址 |
| `OPENAI_IMAGE_MODEL` | 可选 | `gpt-image-2` | 覆盖图像模型名 |
| `ENABLE_GARDEN_IMAGEGEN` | 可选 | 未设置 | 打开本地直连生成/编辑模式 |
| `IMG_GEN_HOST_HAS_IMAGE_TOOL` | 可选 | 未设置 | 告诉 mode detector：宿主自己能出图 |
| `CODEX_BIN` | 可选 | `codex` | 自定义 Codex CLI 路径 |

这些环境值可以放在以下位置：

- 仓库根目录 `.env`
- 仓库根目录 `.gateway.env`
- `~/.gateway.env`

## 快速开始

### 1）先看当前会走哪种模式

```bash
npm run check-mode
```

如果要 JSON 输出：

```bash
npm run check-mode -- --json
```

### 2）先组 prompt

```bash
npm run build-prompt -- --query "AI 视频应用落地页主视觉" --json
```

如果想先看 routing brief，确认哪些信息参与模板匹配、哪些信息保留为内容负载：

```bash
npm run analyze-routing -- --query "ToF 激光雷达测距原理图，包含公式标注" --json
```

如果只想看模板组合结果：

```bash
npm run compose -- --query "RAG 架构科学信息图" --json
```

### 3）直接生成图片（Mode A）

```bash
npm run generate -- --prompt "A cinematic product hero shot of a translucent wearable device" --size 1536x1024
```

### 4）直接编辑图片（Mode A）

```bash
npm run edit -- --image ./assets/source.png --prompt "Replace the background with a clean studio scene"
```

### 5）跑一次仓库 doctor

```bash
npm run doctor
```

## 直接脚本入口

如果你不想走 npm scripts，也可以直接这样调用：

```bash
node scripts/check-mode.js --json
node scripts/analyze-routing-intent.mjs --query "..." --json
node scripts/build-prompt.mjs --query "..." --json
node scripts/compose-templates.mjs --query "..." --json
node scripts/generate.js --prompt "..."
node scripts/edit.js --image ./source.png --prompt "..."
node scripts/doctor-img-gen-pro.mjs
```

## 输出行为

默认情况下，运行时产物只保留在本地：

- prompt 写入 `img-gen-pro/prompt/`
- 生成图片写入 `img-gen-pro/image/`

这些运行产物默认会被 git ignore。

## 目录结构

```text
img-gen-pro/
├── SKILL.md
├── README.md
├── README.zh-CN.md
├── LICENSE
├── package.json
├── data/
├── evals/
├── references/
├── scripts/
└── .dev/
```

## 在 OpenClaw 中怎么用

如果你在 OpenClaw 里使用，把这个仓库作为 skill 安装或挂载，并让运行时指向 `SKILL.md`。当前主要集成目标确实是 OpenClaw，但 prompt / data / scripts 这一层本身也可以脱离 OpenClaw 单独使用。

这个 skill 的设计目标是：

- 把图像请求路由到有约束的 prompt 工作流
- 先走模板，再决定是否自由发挥
- 当视觉方向有歧义时主动澄清
- 把 prompt 构建和渲染执行分开

## 这个仓库没有承诺什么

这个仓库**不承诺**：

- 一键适配所有图像提供商
- 自带通用 GUI
- 在所有宿主里都自动把图片回传聊天
- 从参考图精确逆推出原始 prompt

它要做的是：让图像工作流更可复用、更可解释、更少依赖一次性 prompt 手活。

## 内部维护说明

`.dev/` 是维护者工作区，用来放 rebuild helper、schema 说明和本地检查，不属于运行时契约的一部分。

## 给 fork / 二次开发者的建议

如果你准备扩展这个项目，建议先确认：

- 新增模板是否真的接进了路由链
- 运行时产物是否仍然被 git ignore
- 没有提交私钥、API key 或本地渲染结果
- 所有宿主特定的 Mode B / Mode C 假设都写进文档

## License

MIT
