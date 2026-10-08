# 游戏机制阶段全量终审报告（read-only）

> 评审日期：2026-10-08。独立评审会话产出（工作树全集，无 commit 基线），已独立复跑
> `bun test`（109/109）与 `bun run check`（全绿）。原样存档；执行者的修复记录见
> `.superpowers/sdd/2026-10-01-game-mechanics/progress.md` 尾部与本文末尾附注。

评审范围：工作树全集（无 commit 基线），对照 experiment/experiment/env2.py（权威）、docs/game-mechanics.md（规格）、docs/superpowers/plans/2026-10-01-game-mechanics.md（计划）、.superpowers/sdd/2026-10-01-game-mechanics/progress.md（裁定台账）。已独立复跑 bun test（109/109 pass，590ms）与 bun run check（typegen+eslint+tsc 全绿）。

## Strengths（具体到 file:line）

1. env.ts 对 env2.py 的移植保真度非常高，逐阶段对照后确认所有阴湿角落均照抄：
   - Q1 旧位置拒绝环的完整语义（env.ts:230-246——旧 pos 固定导致 bad 集不变、每轮只重掷首个 bad 对、400 轮封顶；reset.test.ts:52-61 以 81+881 抽取计数锁定）；
   - sanitize 的 enable_black_domain 检查用 raw actions 而非 eff（env.ts:615-617 ⇔ env2.py:393）；
   - 反咬判定用 re 覆盖后的原始动作而非 sanitize 后的 eff（env.ts:810-811 ⇔ env2.py:515，台账裁定落实，Q9 语义正确）；
   - 护盾对"本刻已被击杀但未 8b 结算"尸体照常扣款、无 alive 检查（env.ts:776-783，resolve-b.test.ts:208-232 专门锁定扣款顺序：shield 先扣 5、8b 再收余量 5）；
   - 阶段 6 观测复用打击前活标志快照的 knownAliveD（env.ts:750,857 ⇔ env2.py:458-460 建矩阵、:552 复用）；
   - peak_tech 在爆炸前更新（env.ts:877-879 ⇔ env2.py:566，本刻爆炸增益不计入峰值——quirk 照抄）；
   - numpy _lerp 的 t≥0.5 分支（env.ts:36-39，金标准历史缺陷③修复）；percentile P25–P75 线性插值有专项测试（resolve-c.test.ts:85-103：[1,2,3,4]→[1.75,3.25]）。
2. 金标准回放门是真门（Review Focus 1 满足）：rng.ts:213-256 的 ReplayRng 逐条断言方法+lo/hi+size（矩阵按乘积、choice 按候选集逐元素），assertExhausted（rng.ts:259-263）锁"少抽/多抽"两个方向；golden-replay.test.ts:42-65 逐刻全状态 1e-12 + obs 1e-6 + info 1e-10 + rewards 1e-12 + 逐刻守恒。历史捕获的 3 处移植缺陷（feature-major 布局、域内目标几何保留、_lerp 分支）在 testdata/README.md 有完整披露并回写 CLAUDE.md 已知出入——门的工程价值已被证明。
3. 感知过滤（Review Focus 2）结构正确：view.ts:188-272 逐规则锚定注释，只 diff 玩家自己的 known/observed/public 行（规则⑦⑧天然不可能泄漏）；view.test.ts:32-53 直接构造 AI 互杀刻断言该刻零新增日志。他人探测/被观测反曝光/被打击幸存均无渲染路径。
4. 2026-10-08 回归修复正确且该类问题无残留（Review Focus 6）：view.ts:183 的 [...this.log] 快照 + client.ts:67 构造后先 update() 再 start()。我逐一核对了 MatchView 其余字段的引用语义——markers/valid/targetCandidates/self/invasion 每次 update 均为新数组/新对象字面量（view.ts:114-157）；end 引用恒定但终态不可变、只赋值一次（match.ts:268-286），无陈旧渲染可能。view.test.ts:168-180 把引用契约钉进测试。排队期"恰 1 刻"的数学论证（初始池 ≥70 > 预滚上限 20）我独立复核成立（4×U[5,20] 最大 80 < 预算 150，永不触发缩放）。
5. 对手层口径经得起对照：presets.ts 与 train2.py:40-52 逐行同构（含 && 短路 = python and 同语义，presets.test.ts:35-37 专测）；pickTarget 不移植 train2:33-34 死代码分支，random/model 走均匀（stage_b.py:52 实际路径，已核实）；actBatch 消耗序 = model.py:146-156（先 uniformArray(B) 后逐探索行 choice，dqn.test.ts:52-61 锁定）。DQN 前向 12 模型 |ΔQ|≤1e-9（Review Focus 3），容差论证（BLAS 求和序 vs 转换错误量级）在 record_dqn_outputs.py 文档与计划注记中成立。
6. 终局/边界守卫齐全（Review Focus 4）：env.ts:472 done 抛错 + resolve-c.test.ts:125-138；match.ts:108/124/138 phase 守卫 + match.test.ts:30-46（ended 后 submit 抛 /ended/）；t=250 边缘由 won 用例（match.test.ts:101-112）覆盖。
7. gates-parity 方向选对了（Review Focus 5）：gates-parity.test.ts:18-50 断言 gateOf 禁用 ⊆ env 无效——这正是使 action-grid.tsx:65 的 !valid || reason 合成安全的那一个方向（env-valid ⇒ gateOf-null）。
8. stats 第二口径两端约定一致（我逐项核对）：record_golden.py:326-331 与 stat-equivalence.test.ts:65-73 同为 n·tMax 分母、同为仅活者动作计数、kinds 同为 i%3 模式；带宽披露（±0.10/±12/±0.06）与单种子披露齐备。
9. 约束面干净：experiment/ git porcelain 为空（源码零改动；唯 __pycache__ 见 Minor④）；无 <canvas>、全部动画为 CSS @keyframes（grep 证实无 rAF/interval/timeout）；组件层无中英硬写文案（例外见 Minor⑥）；"use client" 布局符合架构约定（例外见 Minor⑤）；金标准三脚本只经 sys.path 只读引用。
10. 台账纪律好：23 任务每项有测试证据行，19 条裁定均给出理由与代价（如席位重设计 progress.md:70、cancelRechoice 语义 :83、ScriptedRng 原样契约 :25），偏离可追溯。

## Issues

### Critical (Must Fix)

无。

### Important (Should Fix)

1. **src/lib/solo/view.ts:140-148 —— 黑域标记泄露活体情报，且与自身注释及规格双重不符**
   - 问题：对"已知+曾观测、后入域"的文明，marker 的 tech/res 直接读 env.tech[j]/env.res[j]——是活值，随域内发展（×0.2）、流失、爆炸持续变化。代码注释写"封存者显示冻结值"、规格 game-mechanics.md §7 写"domain（封存，含冻结情报）"，实现两者都不是。而环境本身对域内目标的情报是完全掩蔽的（env2.py:313,317：known_pair 含 ~in_domain → 近邻块 tech=−1/res=−0.05）——即 DQN 对手看不到的东西，UI 显示给了玩家。
   - 实证：我构造场景验证——slot0 被观测后入域，marker 从 {tech:1.15, res:9.97} 演变为 {tech:50, res:0.4}，同时 env.obs() 玩家行的近邻块为 -1.00/-0.05（全掩蔽）。玩家能看着"封存"文明的资源倒数到饿死。
   - 为何要紧：本阶段的核心交付物就是"严格忠实感知过滤"（规格 §7 原则："宁可玩家少知道，不给环境没赋予的信息"，规则⑪）。虽然域内文明永久不可交互（泄漏战略上惰性），但这是渲染了环境机制未赋予的信息，且是 Review Focus 2 的同类失效模式；注释与实现自相矛盾还会误导后续维护。
   - 如何修：ViewTracker 增加 frozenIntel: Map<number, {tech, res}>——在 processTick 中检测 in_domain[j] 0→1 跳变时，若 observed[p][j] 则快照当刻 tech/res；view.ts:146-147 对 state === "domain" 改读快照。补一条 view 测试（入域后域内再演变，断言 marker 数值不变）。更简单的替代：domain 态一律不显示 tech/res（环境本就不给）——但那是对规格"含冻结情报"的收窄，需同步改规格措辞。

### Minor (Nice to Have)

1. src/i18n/en.ts:80-85,59-60,113,164 + zh.ts 对应行 —— 10 个孤儿键：match.demo×6、opp.learner.name/desc、actions.repeat、label.civ 在两词典中存在但无任何引用，且 DESIGN.md §7 已无这些行（grep 证实）。demo bar 移除时（Task 22）清单只删了 log.blocked，漏了 demo 系。按项目自己的流程（词典镜像 §7），应连同 DESIGN.md 复核后一并清除。无运行时影响（类型安全），属词典卫生。
2. src/lib/engine/env.ts:216 —— Math.hypot 与 numpy linalg.norm 的 1-ulp 分歧未披露：hypot 是正确舍入实现，numpy 走 sqrt(dx²+dy²)，极端情况下末位不同。当前被容差吸收（状态 1e-12、obs fround 后 1e-6）且 6 条轨迹实测零触发，但它是再生成轨迹时的潜在 flake 源（d<12/d≤30 阈值翻转需 dist 恰在 1 ulp 内，测度零）。建议：在 testdata/README.md 容差节补一行披露，或改 Math.sqrt(dx*dx+dy*dy) 与 numpy 同构。
3. src/app/globals.css:104,136 —— anim-seal 死 CSS：@keyframes seal 与 .anim-seal 无任何组件引用（疑似为域标记设计、未接线）。顺带：域标记没有入场动画，而 marker.tsx 的 ping/alert 等其余 anim 均在用。
4. experiment/experiment/__pycache__/{data2,env2}.cpython-312.pyc（10-02 18:55）：台账 Task 13 记录"pycache 已清"，但其后被再次运行的 Python 重建（时间晚于 testdata 生成时间，非源码改动）。提交前应再清一次，避免把字节码带进对 experiment/ 的引用快照。
5. src/lib/solo/client.ts:1 —— "use client" 越出计划约定集：计划 Global Constraints 写明该指令"仅存在于页面组件与 client-layout.tsx"。此文件只被 client 页面（match/page.tsx）导入，指令冗余且无害，但属约束文本层面的漂移——要么删指令，要么在 CLAUDE.md 架构备注里把 hooks 模块纳为允许项。
6. src/app/match/page.tsx:37 —— Suspense fallback 的字面 …：硬编码可见字符（双语惰性，语义中性）。严格按"组件层禁止任何硬编码用户可见字符串"应入词典或改为纯 CSS 装饰。
7. src/lib/solo/view.ts:101 —— invader ?? 0 兜底会假名 slot 0：awaiting-rechoice 下 getPendingInvader() 恒非空（match.ts:240-243 不变式），兜底不可达；但一旦不变式破坏，错误会被归因到 #0 而非暴露。建议改为省略 id 或断言。
8. src/lib/solo/match.ts:111,200 —— 魔法数 4/6：action === 6、a !== 4 && a !== 6 未用 A_INVADE/A_STRIKE 常量（同文件其余处风格统一用常量）。纯可读性。
9. src/lib/solo/match.ts:186 —— env.obs() 在 byArm 循环内逐臂重算：纯函数、结果相同，12 臂时多算 11 次（36² 规模下无感）。提到循环外一行即可。同类：view.self.windup 已计算但 UI 从未渲染（玩家自己声明黑域的风窗刻无任何面板指示，仅行动格 lastAction 高亮）——留作 UX 走查项。

## Declined to judge（搁置项）

- /online 大厅与 ONLINE/LEGEND_CIVS mock 的内容质量——明确留待路线第 5 步（在线模式），超出本阶段。
- 视觉细节（popover 摆放钳制、布局、配色）——原型阶段已经用户验收，本轮只核机制接线。
- dqn parity 容差 1e-9 vs 规格草稿 1e-12——计划 Task 17 注记已给出 BLAS 求和序论证并要求写入 README，属已论证的技术必要放宽。
- golden-replay 的 obs 比对从计划草稿的 toEqual 精确相等放宽为 1e-6——testdata/README.md 已披露且论证（f32 eps 之上一个量级、逻辑缺陷偏差 ≥1e-2），工程上合理。
- catalog.ts 的 meta/override 英文技术记号（"600ep · seed 42"、"shield_cost_frac=0.25"）是否算需本地化的用户文案——台账裁定为 mono 数据展示；属产品口径，非机制正确性问题。
- EventLog 用 key={index}——append-only 日志无重排，实践安全；换内容寻址 key 属锦上添花。
- 性能整体（O(n²) 显式循环、每刻 obs()/valid() 重算）——36 槽规模 + 一致性优先的既定架构决策（规格 §3.5）。
- 玩家 STRIKE 显式目标未在 submitAction 校验（非法目标静默降级为最近已知）——与 env beginTick 的兜底语义一致，且 UI 只提供合法候选，属忠实行为的边界宽容。

## Assessment

**Ready to merge? With fixes**

**Reasoning:** 引擎/对手/会话三层的一致性验收是真的（我独立复跑全绿，且 env.ts 与 env2.py 的逐阶段对照未发现任何语义漂移，含全部已知 quirk）；唯一实质缺陷是 view.ts 黑域标记的活体情报显示——它违反本阶段自立的严格忠实原则并与自身注释矛盾，修复面约 10 行 + 1 条测试，建议随 Minor 1/4（孤儿键、pycache）一并处理后合入，其余 Minor 均可延后。另指出两处计划层缺陷供复盘：T20 未给"冻结情报"任何实现/测试任务（Important 1 的根因）；T22 清理清单漏列 demo 系词典键（Minor 1 的根因）。

---

## 附注（执行者修复记录，2026-10-08）

- **Important 1 已修**（RED→GREEN）：`ViewTracker.frozenIntel` 快照 + domain 标记改读冻结值。快照点比评审建议更早一刻——**风窗刻末**（声明刻）而非域生效刻：env2.py:313 的 known_pair 只滤 ~in_domain 不滤 windup，观测情报在声明刻末仍在喂 live 值，域生效刻起才掩蔽——故风窗刻末恰为玩家收到 live 情报的最后时刻，快照精确（非近似）。新增 view.test 用例锁定（入域后域内演变，marker 保持封存值而 env.tech 前进）。
- **Minor 1 已修**：10 个孤儿键（match.demo×6 / opp.learner×2 / actions.repeat / label.civ）自 en.ts+zh.ts 删除（先 grep 证实零引用）。
- **Minor 4 已修**：experiment/__pycache__ 再清。
- **Minor 2/3/5/6/7/8/9 延后**（台账 deferred，见 progress.md 尾部）。
- 复盘确认两处计划缺陷：T20 冻结情报无任务、T22 清理清单不全——已记台账。
