# invest-analysis-pro

`invest-analysis-pro` 是一个面向 Agent 的投资研究 Skill：把股票数据采集、结构化证据整理、策略框架、角色化研究流程和标准报告格式封装成可被主控 Agent 调用的研究能力。

它的公开入口只有：

- `SKILL.md`：Agent 使用时读取的主契约。
- `README.md`：给人类快速理解定位、边界、安装方式和维护状态的辅助说明。

本 Skill 不是给人类手动操作的程序包说明，也不把 Web 服务、桌面端、REST API 或命令行教程作为当前产品入口。人类只需要把这个 Skill 交给支持本地文件/命令执行的 Agent，然后直接提出研究请求。

## 当前定位

- **Skill 名称**：`invest-analysis-pro`
- **面向对象**：OpenClaw / Codex / Claude Code / 其他可读取 Skill 并执行本地工具的 Agent
- **产品形态**：Agent-native investment research workflow
- **核心职责**：为 Agent 提供投资研究数据采集、证据审计、多人设研究 DAG、标准报告约束
- **默认行为**：用户给出股票并要求分析时，默认执行 `specialist` 完整研究流程
- **输出边界**：最终判断和报告由调用方 Agent 完成；内部数据适配层只返回结构化 evidence
- **使用边界**：适合研究辅助、信息整理、策略复盘和 Agent 工作流编排；不承诺收益，不构成个性化投资建议

## 覆盖市场与研究对象

| 市场 / 对象 | 覆盖说明 |
| --- | --- |
| A 股 | 个股行情、历史走势、技术指标、资金流、板块、龙虎榜、部分基本面与新闻舆情等，取决于本地数据源可用性。 |
| 港股 | 个股行情、历史走势、技术面、部分基本面与新闻舆情等，取决于数据源覆盖。 |
| 美股 | 个股行情、历史走势、技术面、部分基本面与新闻舆情等，取决于数据源覆盖。 |
| ETF / 指数 / 市场 | 可作为市场温度、行业对照、风险背景和组合分析的辅助 evidence。 |
| 策略与持仓 | 可读取策略 YAML、回测结果、持仓/风险相关上下文，供 Agent 作为判断框架和约束条件。 |

外部数据源可能因接口变更、网络质量、限流、字段缺失而返回部分数据。Skill 的流程要求 Agent 区分 `ok`、`partial`、`failed`，保留可用 evidence，不编造缺失项。

## 主要功能

| 能力 | 说明 |
| --- | --- |
| 结构化数据包 | 获取或接收 quote、history、technical、trend、均线、量价、形态、chip、fundamentals、stock info、capital flow、板块、龙虎榜、市场数据、news/intel、backtest、portfolio/risk、strategies、bundle 等 evidence。 |
| 多档研究流程 | 支持 `quick`、`standard`、`full`、`specialist` 四档；默认 `specialist`，除非用户明确要求快速模式。 |
| 角色化研究 | 把技术面、信息面、风险面、估值/基本面、策略框架等研究任务拆成可并行或依赖执行的 DAG，最终由主控 Agent 汇总决策。 |
| 策略框架 | `strategies/*.yaml` 作为 Agent 可读取的交易框架、判断规则和提示参考，不触发内部 LLM 自动决策。 |
| 标准报告 | `references/report-standard.md` 约束完整报告、简报、短消息和决策面板的结构，吸收了原有报告模板中的核心栏目。 |
| 主流 Agent 兼容 | 支持本地 shell 能力、Agent 提供 evidence、或无本地工具的降级模式。 |
| 可选运行时 | Web、API、通知、定时任务、bot、docker 等目录保留为兼容和后续本地化基础，不是当前 Skill 的默认主路径。 |

## 安装与接入方式

### 推荐方式：作为 Agent Skill 使用

先把 Skill 仓库克隆到本地或团队工作区：

```bash
git clone https://github.com/17636191639/agent-skill.git
cd agent-skill
```

然后把 `invest-analysis-pro/` 作为一个本地 Skill 目录交给你的 Agent。普通用户不需要手动执行内部 CLI；只需要对 Agent 说“用 invest-analysis-pro 完整研究某只股票”。

### OpenClaw

把整个 `invest-analysis-pro/` 文件夹复制到：

```bash
~/.openclaw/skills/
```

接入后，OpenClaw Agent 应以 `SKILL.md` 为主入口，按其中的 evidence-first 流程执行研究。

### Codex / Claude Code / 其他 Agent

对于 Codex、Claude Code 和其他支持本地 Skill 的 Agent，使用同一个原则：

1. 把整个 `invest-analysis-pro/` 文件夹放到该 Agent 自己的 skills 目录下，或作为本地 Skill / 项目上下文接入；
2. 让 Agent 以 `SKILL.md` 作为主入口；
3. 按需读取 `references/`、`strategies/` 和本地数据适配代码；
4. 如果 Agent 具备 shell 能力，可走本地 evidence 采集；
5. 如果没有 shell 能力，可由用户或外部系统提供 evidence，Agent 只执行研究与报告流程。

之后可以直接向 Agent 提出自然语言请求，例如：

```text
用 invest-analysis-pro 完整研究中芯国际，默认深度即可。
```

## 典型使用方式

```text
帮我完整研究中芯国际。
```

默认执行 `specialist` 模式：采集/整理完整 evidence，按多角色 DAG 研究，最后由主控 Agent 汇总为标准报告。

```text
快速看一下大唐发电的技术面和主要风险。
```

用户明确要求快速模式时，才使用 `quick`。

```text
用趋势跟踪和缩量回调两个策略框架评估贵州茅台。
```

Agent 应读取 `strategies/` 中相关 YAML，将其作为判断框架，而不是让策略文件自动生成结论。

```text
我只有下面这些行情和新闻数据，请按 invest-analysis-pro 的报告标准分析。
```

Agent 可进入 provided-evidence 模式：不强行调用本地数据层，只基于用户提供 evidence 做审计、分析和报告。

## 标准工作流

1. **识别任务**：确认股票、市场、时间范围、研究深度和用户特别关注点。
2. **获取 evidence**：优先构建结构化 bundle；若外部源失败，保留可用数据并标注缺口。
3. **审计 evidence**：检查新鲜度、覆盖度、缺失字段、来源链和异常值。
4. **角色化研究**：按模式执行技术面、信息面、基本面/估值、风险、策略框架等研究任务。
5. **主控汇总**：主控 Agent 对各角色结论做冲突处理、置信度标注和投资假设整理。
6. **生成报告**：按 `references/report-standard.md` 输出完整报告、简报或短消息。
7. **记录限制**：明确未覆盖数据、失败来源、时效风险和不可验证假设。

## 内部资料组织

| 路径 | 作用 |
| --- | --- |
| `SKILL.md` | Skill 主入口，只保留触发条件、核心流程、模式选择和关键 gotchas。 |
| `README.md` | 给人类看的项目定位、安装接入和维护边界说明。 |
| `references/` | Agent 运行时可按需读取的工作流、prompt、报告标准、输出契约等资料。 |
| `references/prompts/` | 角色化研究任务说明，供主控 Agent 派发子任务时使用。 |
| `references/report-standard.md` | 标准报告结构和输出格式约束。 |
| `strategies/` | 交易框架、判断规则和 prompt reference。 |
| `src/agent/` | 面向 Agent 的工具封装与本地 evidence 采集入口。 |
| `data_provider/`、`src/services/` | 数据源、缓存、降级、计算和业务能力的复用层。 |
| `api/`、`apps/` | 可选观察、配置、回看和管理界面；不是 Skill 默认入口。 |
| `bot/` | 上游项目保留下来的机器人接入能力，当前主要作为后续本地化候选，不是默认路径。 |
| `docker/` | 上游项目保留下来的容器化部署能力，当前不作为 Skill 推荐安装方式。 |
| `templates/` | 可选报告模板资产，核心报告约束已整理到 `references/report-standard.md`。 |

## 当前状态与边界

- 当前最稳定的使用方式是 **Agent 读取 Skill + 本地或外部 evidence + Agent 生成报告**。
- 数据采集路径不要求配置任何 LLM provider key。
- 默认不启动 REST API，不要求用户手动运行 Web、bot 或 docker。
- Web/API/通知/定时任务等能力保留为兼容面和观察面，后续会继续拆分哪些应作为 Skill 附属能力，哪些应移出。
- `bot/`、`docker/` 仍有较强的上游项目痕迹，现阶段不推荐作为新用户入口。

## 蓝图 / Roadmap

### 近期

- 继续收敛公开入口，让顶层只暴露 `SKILL.md` 与 README 的清晰语义。
- 为 OpenClaw、Codex、Claude Code 补充更明确的安装适配说明和示例任务。
- 增加离线 fixture 与 eval，验证不同 Agent 是否能稳定执行 quick / standard / full / specialist 四档流程。
- 梳理 `bot/`、`docker/`、Web/API 等可选运行时，明确哪些保留、哪些拆出、哪些改造成纯观察面。

### 中期

- 强化 evidence coverage 评分、来源链解释和 partial failure 诊断。
- 把更多报告模板和策略框架转成 Agent 更容易读取的结构化 reference。
- 增加多市场、多行业、多风格的标准评测用例。
- 建立面向维护者的上游项目选择性吸收流程：只吸收数据源、缓存、降级、测试等基础能力改进，避免回退当前 Skill 产品语义。

### 长期

- 形成可在多种 Agent 平台复用的投资研究 Skill 标准包。
- 支持团队内自定义策略库、行业模板、风控约束和报告风格。
- 将非核心运行时能力拆成可选扩展，保持主 Skill 轻量、清晰、可审计。

## 致谢与来源

invest-analysis-pro 并不掩饰自己的来源。它建立在上游仓库 [ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) 的数据能力、工程资产和历史思路之上，但当前对外产品语义、Skill 工作流、Agent 调度方式和文档组织已经围绕 `invest-analysis-pro` 重新整理。

感谢上游项目为多市场股票数据、分析链路和工程实现提供的基础。当前仓库更关注 Agent-native、evidence-first、controller-led 的研究工作流。

## 免责声明

invest-analysis-pro 只提供研究工作流、数据整理和报告结构辅助。所有输出都依赖数据源质量、Agent 执行能力和用户提供的约束条件，不构成投资建议，也不保证任何收益或风险规避效果。
