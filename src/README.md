# 源码职责与依赖约定

| 目录 | 职责 |
| --- | --- |
| `domain/` | 与界面无关的业务类型、干员档案、排班模型、标识解析、产出权重与通用计分 |
| `rules/` | 订单概率和订单价值规则 |
| `engine/` | 静态效率、心情和基础收益计算 |
| `scheduler/` | 排班编译、运行状态、任务队列、策略和排班参与者校验 |
| `simulator/` | 事件时间线、生产与资源记录、动态仿真，以及仿真报告的计分适配 |
| `optimizer/` | 候选枚举、组合筛选、方案搜索和比较 |
| `workbench/` | 工作台状态、配置、导入导出、计算桥接与报告展示模型 |
| `workbench/composables/` | Vue 工作台的持久化、收益计算任务与自动排班任务控制 |
| `components/workbench/` | 页面、编辑器与弹窗；`WorkbenchShell.vue` 负责界面组装与交互路由 |
| `test/helpers/` | 仅由回归测试使用的时间线等辅助函数 |

`workbench/session.ts` 创建每个工作台实例共享的响应式状态。收益计算和自动排班各自管理 Worker、进度、取消和卸载清理；持久化模块负责原有存储键、旧版迁移和干员库交换。界面样式位于 `components/workbench/WorkbenchShell.css`，由原页面以 scoped 样式加载。

共享产出计分由 `domain/productionScore.ts` 唯一实现；`simulator/productionScore.ts` 将已完成生产的仿真报告转换为通用计分输入。排班模型位于 `domain/roster.ts`，干员名称、代号和 ID 解析位于 `domain/operatorIdentifiers.ts`。底层模块直接引用这些位置。

`workbench/model.ts`、`optimizer/productionObjective.ts` 以及 Mower JSON 模块的原标识解析导出保留为兼容入口，供既有脚本或集成使用，不重复实现规则。

领域、收益引擎和排班模块不依赖 Vue、Pinia、界面或优化器。仿真模块不依赖优化器；专用 Worker 可以调用工作台桥接以接收界面请求。`test/architecture.spec.ts` 检查这些依赖约定，包括类型引用，并确保所有 Vue 组件都有应用入口。

跑单仅使用理想收益模型。`scheduler/mowerDroneOperations.ts` 负责仍在使用的普通贸易站和制造站无人机操作，其接口接收明确的资源保留和重复加速策略；原有葛朗台任务选项及未被当前功能使用的旧面板、Worker 和算法已经清理。普通无人机分配、理想跑单、当前自动排班和诊断脚本继续使用各自的业务模块。

公式、随机种子、配置结构、存储键、Mower 往返保留字段及任务执行语义属于行为契约。调整文件位置时，应保留实现，并通过界面交互回归、静态/动态计算和固定输入前后对比验证。

长期排班测试通过 `test/evidence.ts` 将新报告写入 `artifacts/test-evidence/`。设置 `RIIC_TEST_EVIDENCE_DIRECTORY` 可以选择 `artifacts/` 下的独立输出目录。`validation/` 中的原始排班、截图和历史审计记录继续作为输入保存。
