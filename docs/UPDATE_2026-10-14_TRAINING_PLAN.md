# 2026-10-14 固定按无训练计划计算

用户要求删除「有未完成的训练计划」选项，并将全部本地模拟固定为无训练计划。

## 行为与兼容

- 计算弹窗删除该选项；默认设置、确认参数和 Worker 请求不再包含可调训练计划状态。
- 读取旧本地设置时只移除 `masteryPlanPresent`，保留其他模拟偏好、干员库和排班。
- `op_data.facility_has_mastery_plan('train')` 在本地模拟始终为 false；正条件不触发，否定条件正常判断。省略参数和旧调用残留的 true 不再改变结果，也不产生缺少训练状态错误。
- 保留原生 Mower 主副排班触发表达式和 `enable_mastery` 高级配置的导入导出；训练进度和实际设备专精仍未模拟。无训练条件的旧行为保持原契约。

## 验证与交付

本次17个相关测试文件共226项通过：界面/持久化/Worker48项、训练规则48项、其他副表/编译/桥接/架构130项。先验红灯包含界面2项、训练规则13项预期失败，补齐后均转绿。训练室否定条件在真实模拟片段中完成桃金娘、褐果进驻，正条件始终未激活；原输入和原生JSON不变。双方已交叉审查实际差异，没有遗留问题。

`vue-tsc -b --force`、结构索引和离线 skill 校验退出0。Vite生产构建12.20秒成功，仅保留原有大分包提示。skill 含22个核验文件、48条相对引用，包 SHA256 为 63b6d1ed6c65f078694cb855125992d31382d3eb3c8445dbeb84cf1c8c5b7325；完整23文件ZIP逐项校验，SHA256为8f47ea44f73e69e90dcfa49a19955b19a8b69e772824f434ca33686f4d3149b5。

基线 main 为 04def42eac7462bb14e030a2d45f3666f91c0c01。1759个已跟踪文件开工备份逐项校验，ZIP SHA256 为 3cf4fb6b6cd88b3f15864506ce1cd22be7d8a657e1f07a3d1030299d698cb593；原有一图流同步任务计划保留，不纳入本次提交。

备份、测试、来源与安装证据写入本地忽略目录 `artifacts/training-plan-disabled-20261014/`。交付沿用主仓库 main、独立后勤 skill 仓库和 D:/Tools/R.I.I.C-Calculator；安装脚本逐项备份和核对程序文件及原用户文件，文件同步不等于实际桌面启动。

程序提交12d2dc192bcb733fafffedfd60cb57687cb12f8d已普通推送，远端main SHA一致；独立skill提交3c39b105a9e67a86679a122b61870af43c69bbf3已普通推送并核对一致。安装同步Status=verified，1007个管理文件哈希一致、1036个原文件完整备份校验、28个原非管理文件保持原字节，未操作WebView2数据。BUILD-INFO注明SourceHadTrackedChanges=true，原因是保留的另一个任务计划；构建前后所有程序输入与12d2dc1提交一致，有单独验证记录。后续文档提交只记录交付，不改变制品程序来源。

该程序提交的 [Pages流水线](https://github.com/Panda-Panta/R.I.I.C-Calculator/actions/runs/38520790335) completed/success；[Windows Release流水线](https://github.com/Panda-Panta/R.I.I.C-Calculator/actions/runs/38520790322) 在最后查询时仍in_progress。此次验证包含DOM、模拟、构建与安装文件，未执行桌面新进程启动或真实Mower设备操作。

2026-10-14 06:01:35 UTC 只读来源复查：GameData 与列出的PRTS页面 current；工具箱 character 与 Mower alpha 的三个固定文件发生上游变化，整体时效 stale。此次仅发布用户指定的固定无计划模型说明，保留旧数据和来源快照；不宣称完整上游最新版本一致。完整差异见 `freshness-before-skill-sync.json`。
