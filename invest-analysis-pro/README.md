# invest-analysis-pro

`invest-analysis-pro` 是一个面向 Agent 的投资研究 Skill。它的公开入口只有：

- `SKILL.md`：Agent 使用时读取的主契约。
- `README.md`：给人类快速理解定位、边界和使用方式的辅助说明。

本仓库不是给人类手动操作的程序包说明，也不把 Web 服务、桌面端、REST API 或命令行教程作为当前产品入口。人类只需要把这个 Skill 交给支持本地文件/命令执行的 Agent，然后直接提出研究请求，例如：

> 帮我完整研究中芯国际
>
> 快速看看大唐发电的技术面
>
> 用策略框架评估 688981 的风险收益

Agent 会按 `SKILL.md` 自动读取内部参考资料、调用本地确定性数据适配层、派发研究角色并汇总报告；用户不需要手动敲任何 CLI 命令。

## 当前定位

- **Skill 名称**：`invest-analysis-pro`
- **面向对象**：OpenClaw / Codex / Claude Code / 其他可读取 Skill 并执行本地工具的 Agent
- **核心职责**：为 Agent 提供投资研究数据采集、证据审计、多人设研究 DAG、标准报告约束
- **默认行为**：用户给出股票并要求分析时，默认执行 `specialist` 完整研究流程
- **输出边界**：最终判断和报告由调用方 Agent 完成；内部数据适配层只返回结构化 evidence

## 使用边界

`invest-analysis-pro` 不是：

- 面向人类的 CLI 教程
- Python 包 / npm 包 / Docker 服务说明
- 常驻 REST API 或 Web Dashboard 产品
- 内置 LLM provider 的自动荐股程序

它可以复用仓库中已有的数据源、缓存、降级、策略 YAML、回测和持仓能力，但这些都只是 Skill 内部 evidence 来源。仓库中若存在看板、API、通知、定时任务、桌面端或本地分析链路，也只作为可选承载、回看或兼容能力，不是当前 Skill 的公开入口。

## 兼容主流 Agent 的执行方式

`invest-analysis-pro` 不绑定某个特定 Agent 运行环境。Agent 按当前环境选择最高可用路径：

1. 可以执行本地命令：调用内部数据适配层获取 JSON evidence。
2. 不能执行本地命令但已有结构化数据：基于已提供 evidence 继续研究，并披露来源与缺口。
3. 没有任何可用 evidence：说明缺少哪些数据，不做假分析。

如果运行环境支持并行研究任务，可以按 DAG 并行处理 Technical / Intel / Fundamentals & Flow 等分支；否则在当前会话按同一 DAG 顺序完成。

## Agent 工作流概览

1. 读取 `SKILL.md` 判断是否触发本 Skill。
2. 根据用户意图选择 `quick` / `standard` / `full` / `specialist`；默认 `specialist`。
3. Agent 自行调用内部数据适配层获取 JSON evidence，并检查 `status`、`coverage`、`source_chain`、`errors`、`warnings`。
4. 按 DAG 派发 Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio 等研究角色。
5. 主控 Agent 不把 Decision 作为独立研究任务，而是按标准报告约束汇总最终报告。
6. 报告必须披露数据缺口、来源质量、风险和不确定性，不得把缺失数据编造成结论。

## 内部资料组织

- `SKILL.md`：触发条件、默认流程、路由、关键 gotchas。
- `references/evidence-contract.md`：Agent 内部数据适配层的 JSON envelope 与命令契约。
- `references/dag-workflow.md`：研究 DAG、并行/串行依赖和模式分级。
- `references/prompts/*.md`：各研究角色 prompt。
- `references/report-standard.md`：最终报告流程、结构和 Decision Dashboard 约束。
- `strategies/*.yaml`：Agent 可读取的策略框架与判断规则。

## 命名约束

当前 Skill、产品名和用户可见入口统一为 `invest-analysis-pro`。文档、报告标题和示例不使用其他项目名指代当前产品。
