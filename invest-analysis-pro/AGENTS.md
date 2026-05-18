# AGENTS.md

本文件约束 `invest-analysis-pro` 仓库内的开发与维护。当前仓库定位是 **面向 Agent 的投资研究 Skill**，不是面向人类手动运行的程序包、Web 产品或 CLI 教程。

## 1. 当前产品边界

- 公开入口只有：
  - `SKILL.md`：Agent 读取的主契约。
  - `README.md`：给人类理解定位和边界的辅助说明。
- `references/`：Skill 内部参考资料，供 Agent 在使用 Skill 时按需读取。
- `strategies/*.yaml`：Strategy Specialist 可读取的策略框架，不是独立 Skill。
- 仓库中若存在 Web/API/桌面/通知/调度/本地分析服务，只作为可选承载、回看或兼容能力；不要把它们写成当前产品主入口。
- 当前 Skill、产品名、用户可见入口统一为 `invest-analysis-pro`。

## 2. 硬规则

- 未经明确确认，不执行 `git commit`、`git tag`、`git push`。
- commit message 使用英文，不添加 `Co-Authored-By`。
- 不写死密钥、账号、绝对路径、模型名、端口或环境差异逻辑。
- 不新增依赖，除非用户明确要求。
- 不为品牌清理做大规模代码重命名；内部兼容路径可保留，但公开语义必须是 `invest-analysis-pro`。
- 不把当前 Skill 写成需要人类手动执行 CLI 的教程；命令只作为 Agent 内部数据适配层调用细节出现。
- 不要求配置 OpenAI / Gemini / Anthropic / DeepSeek / LiteLLM 等 LLM provider key 才能走 agent-native 主路径。
- 不把 REST API 常驻服务、Web 看板或本地分析服务作为 agent-native 主路径。

## 3. 目录边界

- `SKILL.md`：触发、路由、默认 specialist 流程、gotchas。
- `README.md`：人类辅助定位，不承载详细契约。
- `references/`：Agent 内部参考文档、DAG、角色 prompt、报告约束、evidence 契约。
- `strategies/`：策略 YAML 与策略说明。
- `src/agent/`、`src/services/`、`src/schemas/`、`api/`：必要的 agent-native 数据适配与保存桥接。
- `data_provider/`、回测、持仓、市场数据等能力：优先复用，避免平行重写。
- `apps/dsa-web/`、`apps/dsa-desktop/`：只做兼容保留或必要适配，不作为当前 Skill 公开入口。
- `docs/` 是开发阶段资料目录，默认不推送远端；需要公开给 Agent 的内容必须放入 `references/` 或 `SKILL.md`。

## 4. 文档与 Skill 写法

- `SKILL.md` 保持精简：触发条件、必做流程、模式选择、DAG 路由、gotchas、内部参考入口。
- 详细 prompt、DAG、报告格式、evidence contract 放入 `references/`。
- Prompt 文档必须服从当前 Skill 工作流：研究任务读取主控提供的 evidence 与 prior opinions，输出结构化 opinion；不要写成独立产品、服务端分析引擎或人类操作指南。
- 用户可见文字统一使用 `invest-analysis-pro`。
- README 不提供人类手动跑 CLI 的 quick start；只说明人类应向 Agent 提出自然语言研究请求。

## 5. 验证要求

按改动范围选择最小但足够的验证：

- Markdown / Skill 清理：
  - `python scripts/check_ai_assets.py`
  - `rg` 检查旧公开路径、旧品牌、断链引用。
- Python 改动：
  - `python -m py_compile <changed_python_files>`
  - 相关测试文件：`python -m pytest -q tests/<file>`
- Web/Desktop 改动：
  - Web：`cd apps/dsa-web && npm run lint && npm run build`
  - Desktop：按对应 package build；如未验证需说明原因。

## 6. 交付说明

最终交付默认说明：

- 改了什么
- 删除了什么
- 保留了什么以及为什么
- 验证情况
- 未验证项
- 风险点
- 回滚方式
