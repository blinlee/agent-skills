# Output Profiles

Choose the profile from the user's goal. If the user asks for multiple outputs, render them from the same Source Pack and concept model.

| Profile | Use when | Required reference |
|---|---|---|
| `philosophy` | mindset, doctrine, principles, worldview, heart method | `profile-philosophy.md` |
| `playbook` | SOP, workflow, operating rules, tactic library | `profile-playbook.md` |
| `factor-seed` | quant ideas, factor hypotheses, market mechanisms | `profile-factor-seed.md` |
| `knowledge-map` | concepts and relationships | `concept-linking.md` |
| `process` | product/project/management workflow | `profile-process.md` |
| `voice` | author style or judgment habits | `profile-voice.md`; only when requested |
| `memory-session` | chats, reports, work logs, durable lessons | `profile-memory-session.md` |

## Defaults

- If the user says "心法", "哲学", "理念", or "判断力", use `philosophy`.
- If the user says "因子", "alpha", "变量", "可回测", or "研究假设", use `factor-seed`.
- If the user says "方法", "流程", "SOP", or "工具箱", use `playbook`.
- If the user only says "总结", inspect intent. If the source is large and the desired output is reusable knowledge, use this skill rather than ordinary summarization.

## Combined Outputs

Common combinations:

- Trader corpus: `philosophy` + `playbook` + `factor-seed` + `knowledge-map`
- Product corpus: `philosophy` + `process` + `playbook`
- Project logs: `process` + `playbook` + `memory-session`
- Book/course: `philosophy` + `knowledge-map` + `playbook`

Always state profile boundaries so the reader knows what the report optimizes for and what it omits.
