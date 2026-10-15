# 项目开发约定

<!-- BEGIN AGENT DEV WORKFLOW -->
## 默认软件开发流程

进行新项目、功能开发/更新、缺陷修复、重构、测试或工程配置修改时，先读取并遵循 `C:/Users/Panda-Panta/.agents/skills/agent-dev-workflow/SKILL.md`（`$agent-dev-workflow`），再读取项目计划、结构索引及相关领域 skill。该流程是本用户的默认开发约定；用户当前更具体的要求优先。纯问答与只读审查不启动实施或同步。

已被主 agent 委派的 subagent 按派工范围执行，不递归启动完整流程或重复派工；主 agent 统一维护计划、集成验证及交付。
<!-- END AGENT DEV WORKFLOW -->

## 本项目要求

以下要求由项目维护者于 2026-10-12 明确指定，适用于本项目后续开发。

1. 开始修改前核对当前文件结构、Git 状态和已有本地工作；先备份，再在 `UPDATE_PLAN.md` 写清目标、模块边界、分工、影响范围、验证和交付标准。保留用户干员库、排班及安装配置。
2. 多步骤开发使用 subagent 按独立模块并行分工，明确每个 agent 的修改路径；主 agent 负责整合、检查联动影响和最终验证。简单单文件维护不必人为拆分。
3. 每个新机制使用职责明确、可独立测试的模块。共享状态和规则放到领域或规则层；不持续扩张 WorkbenchShell、calculate 或通用组件。
4. 新机制和干员必须验证对其他干员的影响：同站、全局在岗/设施计数、阵营与类别、技能阶段、心情、替补及长期产出；无新内容的旧场景应保持原计算结果。区分数据收录、实现覆盖和真实运行证据。
5. 根目录 `PROJECT_STRUCTURE.md` 为源码结构索引，新增、移动、删除文件时更新；使用 `scripts/update-project-structure.mjs` 生成并在交付前校验。更新流程参见 `DEVELOPMENT_WORKFLOW.md`。
6. 后勤 skill 发布到独立仓库。发布或导入前检查 GameData、PRTS、明日方舟工具箱及相关 Mower 的最新状态，固定来源提交、版本和哈希，验证 frontmatter、相对引用及离线可用性。不得以格式检查宣称所有 agent 平台均已实际导入。
7. 需要修复时，仅在自己的 `Panda-Panta/R.I.I.C-Calculator` 仓库的 `codex/` 工作分支提交，保留原 PR 贡献并通过自己的集成 PR 交付。不得向外部贡献者仓库或其源分支推送、改写，`maintainer_can_modify=true` 不构成授权。无需修复的外部 PR 可正常审查后直接合并，无需另建集成 PR。
8. 最终候选完成审查和必要验证后，使用普通 PR 流程合并并遵守平台保护；候选变化须重验。拉取实际合并后的主线，核对提交及源码树，再按既有脚本预览、备份并安全同步 `D:\Tools\R.I.I.C-Calculator`，完成后核对文件哈希，保留用户配置、排班、干员库和浏览器数据；不强推、不覆盖无关本地工作。处理 PR、修复交付或 Tools 同步时，先读取 `DEVELOPMENT_WORKFLOW.md` 的完整流程。实际工具权限或外部故障阻止交付时说明具体未完成项。
9. 完成报告包含改动、影响验证、测试和构建结果、备份、Git 提交/远程及安装同步证据；维护结构索引和当前计划状态。

本项目已有计划入口为 `UPDATE_PLAN.md`，无需另建重复计划。修改基建规则、排班、Mower 兼容或数据时，读取领域 skill `.codex/skills/arknights-riic-mechanics/SKILL.md`；该目录沿用现有加载位置，并与源码和独立 skill 仓库同步维护。
