# 2026-10-12 基建数据、回收站与源码结构更新

本次补齐德·托莱多、旅骨、克莱门莎的后勤天赋，并将回收站接入排班编辑、Mower 兼容、技能预览及动态生产时间线。既有结构整理和废弃功能清理一同交付。根目录执行约定见 [AGENTS.md](../AGENTS.md)，实施计划见 [UPDATE_PLAN.md](../UPDATE_PLAN.md)，实际源码索引见 [PROJECT_STRUCTURE.md](../PROJECT_STRUCTURE.md)。

## 来源与数据

- [ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData/commit/17759cc8cdf37388414145d16262a3a06f3ab25e)：国服 v078 / 78.0.0，客户端 2.7.81。固定 building、character、版本、术语和物品文件及其 SHA-256。
- [明日方舟工具箱](https://arkntools.app/#/riic)：2.5.0；全部 432 名干员、929 条阶段技能的 ID、解锁条件、设施、原文和图标逐项一致。
- PRTS 固定页面：[德·托莱多](https://prts.wiki/w/德·托莱多?oldid=440178)、[旅骨](https://prts.wiki/w/旅骨?oldid=440890)、[克莱门莎](https://prts.wiki/w/克莱门莎?oldid=440582)、[回收站](https://prts.wiki/w/罗德岛基建/回收站?oldid=441026)。本次新增 8 条阶段技能均按实际表格中的槽、阶段、等级、设施和描述核对。
- [Mower alpha](https://github.com/ArkMowers/arknights-mower/commit/7aac30fbf6a89592ffdfbaad0c52e6b64946f81e)：最终固定回收站、收取和 QR 相关文件。本次开发期间上游从初始 `9091f2b` 前进；独立审查对比 210 个函数，只有宿舍读取和恢复排序的操作计时/记录改变，4 个回收方法及 `todo_list` 的源码与 AST 均相同，15 分钟收取门槛和 QR/排班模型未变，因此无需修改本次产品规则。来源清单已更新到最新提交；其他既有 Mower 调度端口保留各自原来源，不宣称整体时序已对齐最新 Mower。

原有 429 名干员的完整技能槽、阶段、等级、既有标记和记录已比较，除来源标识外保持一致。新头像和技能图标已校验来源与安装文件哈希。运行时档案、可读档案、术语、离线检索及 skill 共用固定来源清单。

## 模块与行为

| 模块 | 职责及本次变化 |
| --- | --- |
| `src/domain/facilities.ts` | 统一设施等级与工位容量，供编辑、校验和优化器复用 |
| `src/engine/supportFacilities/` | 条件、联络/线索、加工和回收技能各自独立；由 `supportFacilitySkills.ts` 提供业务入口 |
| `src/simulator/recycleTimeline.ts` | 材料进度、容量、满仓暂停、收取和暖机/样本分界 |
| `src/workbench/compat/` | 回收站旧存档迁移、JSON 主副表/候补与未知字段保留；新版 14 QR 导出，14/16 QR 导入 |
| `src/components/workbench/SupportFacilityPreview.vue` | 根据实际练度与在岗状态显示联络、线索、加工和回收结果 |
| `scripts/riic-catalog-evidence.mjs` | 数据更新时重新核对 PRTS 阶段，并保留独立来源扩展；回收参数变化时停止沿用旧数值 |
| `scripts/tools-sync-core.psm1` | 安装备份、管理文件更新、用户数据保留、哈希核验及失败回退 |

WorkbenchShell 已拆出持久化、收益计算及自动配员三个 composable 与独立样式。公共计分和干员标识保留统一实现。清理 6 个废弃 Vue 组件及相关专属测试和算法模块，移除废弃面板、Worker、葛朗台任务覆盖和不再使用的依赖；普通无人机操作及理想跑单继续保留。

## 新机制与其他干员的影响

| 条件 | 实际规则与验证范围 |
| --- | --- |
| 德·托莱多办公室 E0/E2 | 联络速度分别 +20%/+30%，自身心情消耗 -0.25/h；同技能槽取最高解锁版本 |
| 德·托莱多宿舍 E2 | 办公室等级 1/2/3 时全体恢复分别 +0.1/+0.15/+0.2/h，含自身；与同类别恢复取最高；覆盖波登可、杜林等宿舍组合 |
| 克莱门莎会客室 E2 | 独处 +20%、自身 +1/h 消耗；有另一名正心情在岗同事时 +35%、自身 +2/h 消耗；心情 0 或离岗同事不触发；同事不获得个人加成 |
| 旅骨回收 E0/E2 | +20%/+30%，同槽替换；另计实际在岗人员基础速度 |
| 旅骨加工 E2 | 仅手性屈光体、重相位对映体相对增加副产物概率 90%；基础 10% 变为 19%，其他配方不变 |
| 回收站等级与人数 | 默认未建；工位 0/1/2/2，耗电 0；已建基础速度 100%/100%/120%，每名实际在岗正心情干员另 +1%；无人时仍运行 |
| 全局与阵营计数 | 覆盖至简、风絮、真言、缪尔赛思、重岳等人数/设施/阵营范围；赫德雷的指定在岗同伴可来自回收站；不同机制保留自身的在岗和心情语义 |
| 候补与自动配员 | 回收技能主力可单人准入；普通干员可作为回收候补，避免只有一名技能干员时遗漏设施；旧设施的候补筛选保持原规则 |
| 库存和收取 | 100% 速度每 48 小时产出一份；容量 5/10/10；满仓暂停，实际收取后恢复；原生待办记录实际收取时点 |
| 旧输入 | 回收站未建且无新增干员时，旧数值及事件保持原结果；仅解释来源版本和新增未建设施结构差异 |

独立审查复现了两项自动候补缺陷，修复后真实入口回归通过。独立 agent 依据发布包完成练度、配方、同站、宿舍和回收边界查询验收，未依赖软件测试中的预期答案。

## 验证与交付记录

本地开发、集成验证、两个仓库发布及安装同步已完成。实际交付产物由干净源码提交 `27be2ccdfbca06896b44e00b5ac31d96c5be13aa` 重新构建；随后补录交付文档的提交不改变程序产物。原始证据保存在本机 `artifacts/gamedata-update-20261012/`，不上传真实干员库、排班或本机配置。

- 五个固定场景：默认、252 双金、252 三金、342 龙门币、真实用户排班。完整数值和事件比较通过，仅排除明确列出的版本元数据与未建回收站结构。
- 类型检查、生产构建通过；235 个测试文件中 234 个通过、1 个原有文件跳过，2329 项测试通过、1 项原有审计报告测试跳过，0 失败，进程退出码 0，未处理错误 0。命令 `node node_modules/vitest/vitest.mjs run --testTimeout=60000 --reporter=default --reporter=json --outputFile=artifacts/gamedata-update-20261012/full-tests-final.json`，并发 2，耗时 832.77 秒。
- 首轮高并发出现两项重计算超时及 runner RPC 超时；限制并发后，两项重计算及完整回归通过。房间数量断言与受保护算法哈希仅按已授权的新设施和规则更新，旧数值断言保留。
- Windows PowerShell 5 安全同步 15/15 夹具和打包入口 7/7 检查通过。覆盖备份哈希、用户数据保留、路径/链接拒绝、失败恢复，以及失败期间外部编辑和重建文件的保留。
- [源码提交](https://github.com/Panda-Panta/R.I.I.C-Calculator/commit/27be2ccdfbca06896b44e00b5ac31d96c5be13aa) 已普通推送，远程 `main` SHA 与本地核对一致；从该提交重跑类型检查、结构/skill 校验及生产构建通过。1532 个来源文件记录哈希，1006 个前端产物和 index 引用核验通过。
- `D:\Tools\R.I.I.C-Calculator` 已同步并验证 1007 个管理文件；28 个原有非管理文件保留并复核哈希，含原生外壳及用户文件。同步前完整备份 1022 个文件、99842306 字节至 `artifacts/gamedata-update-20261012/install-sync-final/backup/`，全部副本和安装文件再次核对。备份清单 SHA-256：`93c5800b6eeee581e66f20b0160d6e4506bf30c64fb76d41040ee6d4187c1343`；安装 `BUILD-INFO.json` 来源为上述提交，`SourceHadTrackedChanges=false`。交付汇总见本机 `delivery-verification.json`。
- [GitHub Pages 流水线](https://github.com/Panda-Panta/R.I.I.C-Calculator/actions/runs/38272366494) 成功；[Windows Release 流水线](https://github.com/Panda-Panta/R.I.I.C-Calculator/actions/runs/38272366502) 在交付补录时仍运行，未将本地通过等同于该流水线完成。
- 独立 skill 仓库：[Panda-Panta/arknights-riic-mechanics](https://github.com/Panda-Panta/arknights-riic-mechanics)，`main` 提交 `5a39c0e30643fe3d68ea12c215c21a62beccd077` 已与远程核对。
- 包校验覆盖 frontmatter、界面 YAML、43 个相对引用、数据/来源一致性、离线查询和损坏/过期检测；发布前最后联网检查于 `2026-10-12T15:38:46.522Z` 为 `current`，当时 Mower alpha 已前进至 `52dba896f03f0ebb5321ea40852f68eda664ff0f`，所列相关文件 SHA 全部一致。包内容指纹 `0b1260d58ef8a7b3df306df0154973fb271ec92145e32ed8f22dedfd31e4c674`。
- [完整 skill ZIP 发布](https://github.com/Panda-Panta/arknights-riic-mechanics/releases/tag/v078-20261012.1)：`arknights-riic-mechanics-v078.zip`，861244 字节，SHA-256 `c5686f75cd6f9e6be6b6f42a50fcc9cbbebfcd5849fce2fd5380c861501dd7e7`；GitHub 上传资产摘要与本机一致。完整保留相对目录即可按各 agent 的官方技能目录导入；每次导入前重新运行 freshness 检查。
- 更新前源码备份：`artifacts/gamedata-update-20261012/backup/source-before-gamedata-update.zip`，SHA-256 `9f1a8abb3f552a8facb1c193fff263a68f6dad08ea13241e53bb00769a2b6990`，逐项校验通过。

## 明确边界

回收加速 +50% 目前作为界面预览；动态时间线未自动假设持续投料，也未实现有限加速时长。随机材料种类、实际价值和其 82 分收益不作虚构估算。回收站的动态换班走新的排班模拟，旧静态轮换器的范围保持原样。

格式、离线脚本及独立 agent 使用已验收；Codex、Claude Code、Copilot 的目录按官方文档说明，未逐一在每个平台实际安装。本次同步未执行桌面程序启动；数值回归和安装文件校验也不等同于真实游戏操作或每个用户场景的保证。
