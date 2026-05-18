<div align="center">

# invest-analysis-pro

**Agent-native investment research skill for A-share, Hong Kong, and US equity workflows**

面向 Agent 的投资研究 Skill：以 **evidence-first** 为核心，复用现有数据能力与策略资产，
由主控 Agent 完成研究编排、分支分析与最终报告生成。

<p>
  <img src="https://img.shields.io/badge/Skill-invest--analysis--pro-0F172A?style=flat-square" alt="skill" />
  <img src="https://img.shields.io/badge/Markets-A%20%7C%20HK%20%7C%20US-2563EB?style=flat-square" alt="markets" />
  <img src="https://img.shields.io/badge/Default%20Mode-specialist-7C3AED?style=flat-square" alt="default mode" />
  <img src="https://img.shields.io/badge/Runtime-OpenClaw%20%7C%20Codex%20%7C%20Claude%20Code-059669?style=flat-square" alt="runtime" />
  <img src="https://img.shields.io/badge/License-MIT-black?style=flat-square" alt="license" />
</p>

</div>

---

## What is invest-analysis-pro?

`invest-analysis-pro` 是一个 **给 Agent 使用** 的投资研究 Skill，不是面向终端用户手动操作的传统 App，也不是默认常驻的 REST 服务。

它的目标不是在数据层直接给出投资结论，而是把以下能力组织成一个可复用的研究工作流：

- 股票与市场数据采集
- 结构化 evidence 整理
- 技术面 / 情报面 / 基本面与资金面 / 风险面 / 策略面研究拆分
- DAG 方式的研究任务编排
- 标准化 Markdown 报告与 Decision Dashboard 输出

对于调用方 Agent 来说，这个 Skill 提供的是一套 **“先取证、再分析、最后汇总”** 的研究框架。

## Project Positioning

### This project is

- 一个 **Agent Skill**
- 一个 **CLI-first / evidence-first** 的投资研究工作流
- 一个适配 **OpenClaw / Codex / Claude Code / 其他本地 Skill Agent** 的研究能力包
- 一个默认以 **`specialist`** 模式运行的完整研究流程

### This project is not

- 一个要求用户手动敲 CLI 的终端工具教程
- 一个默认常驻运行的 Web / REST 服务产品
- 一个内置 LLM provider 调度与自动荐股程序
- 一个在数据适配层直接输出自然语言投资结论的系统

## Public Entry Points

对外公开入口只有两个：

- `SKILL.md`：Agent 运行时读取的主契约
- `README.md`：给人类查看的项目说明、安装方式与维护边界

普通使用时，用户无需手动执行内部命令，只需要对 Agent 提出请求，例如：

```text
用 invest-analysis-pro 完整研究中芯国际。
```

---

## Market Coverage

| 市场 / 对象 | 覆盖说明 |
| --- | --- |
| A 股 | 个股行情、历史走势、技术指标、资金流、板块、龙虎榜、部分基本面与新闻舆情等 |
| 港股 | 个股行情、历史走势、技术面、部分基本面与新闻舆情等 |
| 美股 | 个股行情、历史走势、技术面、部分基本面与新闻舆情等 |
| ETF / 指数 / 市场 | 可作为市场温度、行业对照、风险背景和组合分析辅助 evidence |
| 策略与持仓 | 可读取策略 YAML、回测结果、持仓 / 风险上下文，作为 Agent 判断框架 |

> 外部数据源可能因为接口变更、限流、时延或字段缺失而返回部分数据。`invest-analysis-pro` 要求 Agent 区分 `ok` / `partial` / `failed`，保留可用 evidence，不编造缺失信息。

---

## Core Capabilities

| 能力 | 说明 |
| --- | --- |
| Structured evidence bundle | quote、history、technical、trend、ma、volume、pattern、chip、fundamentals、stock info、capital flow、boards、dragon-tiger、market、news、intel、backtest、portfolio、risk、strategies、bundle |
| Multi-depth workflow | `quick` / `standard` / `full` / `specialist` 四档研究流程 |
| Specialist-by-default | 用户只要给股票并要求分析，默认走最完整的 `specialist` 工作流 |
| DAG orchestration | 支持 Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio 的并行或依赖式编排 |
| Strategy framework reuse | `strategies/*.yaml` 作为策略框架、判断规则与 prompt reference |
| Standard report outputs | Full Markdown report / Brief summary / IM message / Decision Dashboard JSON |
| Agent compatibility | 支持本地 shell 执行、provided evidence 模式、no evidence 降级模式 |
| Runtime compatibility | 保留 Web / API / bot / docker 等兼容运行时，不作为当前主入口 |

---

## Workflow Overview

`invest-analysis-pro` 采用 **controller-led** 的研究模式。

### Default workflow

1. **Identify the task**
   确认股票、市场、研究目标、时间范围、是否要求快速模式。

2. **Collect evidence**
   由 Agent 调用内部数据适配层获取结构化 JSON evidence，或接收外部提供的 evidence。

3. **Run Evidence Audit**
   检查 `status`、`coverage`、`source_chain`、`errors`、`warnings`。

4. **Dispatch research DAG**
   根据模式运行 Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio 分支。

5. **Controller synthesis**
   由主控 Agent 汇总分支意见、处理冲突、披露缺口，并生成最终报告。

### Research modes

| 模式 | 何时使用 | 默认性 |
| --- | --- | --- |
| `quick` | 用户明确要求快速、简短、粗看 | 否 |
| `standard` | 用户明确要求标准档 | 否 |
| `full` | 用户明确要求完整分析，但不需要策略专家分支 | 否 |
| `specialist` | 用户给股票并要求分析 / 研究；或明确要求最详细视角 | **默认** |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/17636191639/agent-skill.git
cd agent-skill
```

### 2. Install as a local skill

#### OpenClaw

将整个 `invest-analysis-pro/` 目录复制到：

```bash
~/.openclaw/skills/
```

#### Codex / Claude Code / other agent runtimes

遵循相同原则：

1. 将整个 `invest-analysis-pro/` 目录放入该 Agent 的本地 `skills` 目录；或
2. 作为本地 Skill / 项目上下文接入；并
3. 让 Agent 以 `SKILL.md` 为主入口执行。

### 3. Start using it from the agent

安装完成后，直接向 Agent 发出自然语言请求：

```text
用 invest-analysis-pro 完整研究中芯国际。
```

---

## Typical Requests

```text
帮我完整研究中芯国际。
```

```text
快速看一下大唐发电的技术面和主要风险。
```

```text
用趋势跟踪和缩量回调两个策略框架评估贵州茅台。
```

```text
我只有这些行情和新闻数据，请按 invest-analysis-pro 的报告标准分析。
```

---

## Repository Layout

| 路径 | 说明 |
| --- | --- |
| `SKILL.md` | Skill 主入口，只保留触发条件、核心流程、模式选择和关键 gotchas |
| `README.md` | 项目说明、安装方式、边界、路线图 |
| `references/` | Agent 运行时按需读取的工作流、prompt、报告标准、契约文档 |
| `references/prompts/` | 各研究角色 prompt |
| `references/report-standard.md` | 标准报告结构与输出格式约束 |
| `strategies/` | 策略框架、规则 YAML、prompt reference |
| `src/agent/` | 面向 Agent 的工具封装与 evidence 采集入口 |
| `data_provider/` / `src/services/` | 数据源、缓存、降级、计算与业务能力复用层 |
| `api/` / `apps/` | 可选观察、配置、回看与管理界面 |
| `bot/` | 来自上游开源仓库的机器人接入层，当前作为兼容保留能力 |
| `docker/` | 来自上游开源仓库的容器化部署层，当前作为兼容保留能力 |
| `templates/` | 可选报告模板资产，核心结构已收敛到 `references/report-standard.md` |

---

## Runtime Boundaries

- 当前最稳定的使用方式是：**Agent 读取 Skill + evidence 获取 / 接收 + Agent 生成最终报告**
- 数据采集路径不要求任何 OpenAI / Gemini / Anthropic / DeepSeek / LiteLLM key
- 默认不要求启动 REST API、Web、bot 或 docker
- Web / API / 通知 / 定时任务等能力目前作为兼容面与观察面保留
- `bot/`、`docker/` 属于兼容保留运行时层，不作为新用户的首选入口

---

## Roadmap

### Near term

- 继续收敛公开入口，保持 `SKILL.md` + README 的清晰职责分工
- 补充 OpenClaw / Codex / Claude Code 的更明确安装示例
- 增加离线 fixture 与 eval，验证不同 Agent 对四档流程的稳定执行能力
- 梳理 `bot/`、`docker/`、Web / API 等兼容运行时的拆分策略

### Mid term

- 强化 evidence coverage 评分、source chain 解释和 partial failure 诊断
- 将更多报告模板与策略框架转为 Agent 更易消费的结构化 reference
- 增加多市场、多行业、多风格标准评测用例
- 建立面向维护者的上游同步策略，优先吸收基础能力改进并维持当前产品语义

### Long term

- 形成可跨多种 Agent 平台复用的投资研究 Skill 标准包
- 支持团队级策略库、行业模板、风控约束与报告风格扩展
- 将非核心运行时拆分为可选扩展，保持主 Skill 轻量、清晰、可审计

---

## Attribution

`invest-analysis-pro` 派生自开源仓库 [ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)。

上游项目采用 **MIT License** 发布；本仓库在遵循相应许可条款的前提下，复用了部分数据能力与工程资产，并围绕 `invest-analysis-pro` 重新组织了 Skill 入口、Agent 工作流、文档结构与对外产品语义。

感谢上游项目在多市场股票数据处理、分析链路和工程实现方面提供的基础。

---

## License

This project is distributed under the **MIT License**. See [`LICENSE`](./LICENSE) for details.

## Disclaimer

`invest-analysis-pro` 仅提供研究工作流、数据整理与报告结构辅助。所有输出均依赖数据源质量、Agent 执行能力与用户提供的约束条件，不构成投资建议，也不保证任何收益或风险规避效果。
