# SDD ledger — plan: docs/superpowers/plans/2026-10-01-game-mechanics.md

执行方式：Native（executing-plans，用户 2026-10-01 选定）。规格：docs/game-mechanics.md v1.0（本会话内完整在手）。

## 全局裁定（Setup Rulings）

- Ruling: **跳过所有 git commit 步骤** — 用户明确"我手动管理按开发阶段提交，无需你考虑"。代价：task-done 台账行的 commit 区间不可计算，以测试命令+结果代替；最终 review 的范围靠工作树 vs 计划文件地图核对。
- Ruling: **不建 worktree，直接在主工作树执行** — 全部源文件 untracked，worktree 从 HEAD 检出会得到空壳（无 src/）；用户整项目皆在主树直接开发，此为既定约定。代价：无分支隔离（用户自管提交，接受）。
- Ruling: **.gitignore 追加 `/.superpowers`** — 防止用户手动提交时误收台账/草稿。代价：无（纯 git 卫生）。
- Ruling: **Bash 分类器临时不可用** — 需要命令的步骤暂缓，先做文件写入型步骤；恢复后补跑（Task 1 的 `bun add -d @types/bun` + `bun test` 为第一批）。

## Pre-flight（任务间接口扫描）

- Row: T5/T7 ← T4：T4 的 makeEnv 内联于 reset.test.ts，T5 Step1 起抽到 `src/lib/engine/test-helpers.ts` 并导出；T7 正式使用。核对：一致（计划已如此写）。
- Row: T13 ↔ T14：录制 args.size 可为 `[r,c]`（矩阵）而 TS 侧 uniformArray(size) 为标量乘积 —— ReplayRng 必须按"乘积相等"校验（T3/T14 已如此规定）。核对：一致。
- Row: T8 ← T3：`ScriptedRng.consumed` 按**值个数**计（uniformArray(1296)=+1296），T8 护盾断言 `before+1296` 与此一致。核对：一致。
- Row: T4 占位 obs/valid（长度断言）→ T5 实装 valid、T10 实装 obs；T7 的 `reset` 返回值依赖两者已可调用。核对：一致（T4 Step3 已注明占位）。
- Row: T20 ← T19：计划缺口——SoloMatch 接口未显式暴露"最近一刻原始结果"。裁定：**T19 实现时增加 `readonly lastResult`（公开）**，ViewTracker 感知过滤依赖它。代价：若遗漏，T20 需回改一行。
- Row: T16 ← 词典：catalog 的 labelKey 需 12 臂皆有键；既有词典仅有部分——T21 执行时核对补齐（计划已含此指令）。核对：已覆盖。
- Row: T17 ← T15：ModelWeights JSON 形状 = {arm, source, updates, shapes, W0..b2}；TS 接口按此定义（shapes 字段可选带过）。核对：一致。

Pre-flight 结论：1 处计划缺口已裁定（lastResult），其余一致。

Task 3: complete (tests: bun test → 6 pass；check/build 绿)
Task 3: Ruling: ScriptedRng 语义 = **原样返回脚本值**（计划的 `uniformRange(0,100)→50` 缩放断言是缺陷）— 引擎全部测试以脚本值=终值构造 — 代价：无（语义更强，env 测试依赖它）
Task 3: Ruling: tsconfig target ES2017→**ES2020**（splitmix64 需 BigInt 字面量）— bun run check + build 验证全绿 — 代价：SWC 产物目标升一档（现代浏览器均支持）
Task 4: complete (tests: reset.test 3/3 pass)
Task 4: Ruling: Q1 测试改为**抽取计数锁定**（962 = 81 + 881，含 400 轮拒绝环×2 值）— 计划断言 `env["prevPos"]` 与实现不符（python 的旧位置是 self.pos 在赋值前被读，无独立字段；TS 用 _hasPos 哨兵镜像 hasattr）— 代价：无（机制级更强）
Task 4: Ruling: 预算溢出测试改为**直接构造完整队列** — 计划该用例误用 makeEnv 追加语义（基础 81 值先耗，res 永远是 40<150 不触发缩放）— 代价：无
Task 5: complete (tests: valid.test 5/5；valid()/selectTargets() 实装，追加 selectTargets 无风窗过滤的 parity 测试)
Task 6: complete (tests: begin-tick.test 2/2；beginTick 实装；计划遗漏修正：STRIKE 行需 known[2,1]=1 候选才入库、_targets 为 Map 访问)
Task 6: Ruling: tick() helper 延至 resolve 存在后加入（Task 7）— 避免未实现方法的类型断裂 — 代价：无
Task 7: complete (tests: 全套 25/25 pass；check 绿；resolve 骨架+阶段0-3 一把过；垂死广播测试拆两个：死者发送者 known[j,j] 不置位（known[alive,j] 范围）、活发送者 Q2 置位)
Task 7: Ruling: dying-curse 测试断言修正 — 计划在死发送者场景断言 known[2,2]=1，但 env2.py:422 `known[alive, j]` 不含死行 — 代价：无（Q2 由活发送者用例锁定）
Task 8: complete (tests: resolve-b 11/11；全套 36/36；阶段4/5/8b 实装)
Task 8: Ruling: **8b 尸体结算随 Task 8 实装**（6 行）— 计划把 8b 放 Task 9 但 Task 8 的 pool 断言全按结算后真值写 — 代价：无（Task 9 减一项）
Task 8: Ruling: stageInvasions 反咬判定用 **rawActions**（re 覆盖后的原始动作，env2.py:515）而非 eff — 计划未明示 — 代价：无（Q9 语义正确性的关键）
Task 9: complete (tests: resolve-c 9/9；全套 45/45；check 绿；阶段6/7/8/9/10 + percentileLinear 实装，obs 尚为占位)
Task 9: Ruling: 测试脚本值三处按 ScriptedRng **原样契约**重排 — 追加值必须先垫过探测1296/boom36/流失36 的批量抽样位（explosion/birth 用例）；observe 用例补出生抑制（出生扩候选集）— 教训：脚本值定位=消耗序算术 — 代价：无
Task 10: complete (tests: obs.test 4/4；全套 49/49；check 绿)
Task 10: Ruling: 计划稿 obs 测试的近邻块索引错位修正 — 实际布局 k=0 块占 17-23（[Δx,Δy,d,tech,res,public,in_domain]），计划稿把 d 写在 20/tech 写在 23 — 代价：无（测试以真实布局重写后一把过）
Task 11: complete (tests: quirks 6 + info-parity 1 = 7/7；全套 56/56；check 绿；锁定任务无 RED 阶段——行为已在所属任务先行 TDD)
Task 11: Ruling: info-parity 场景两处修正 — ① sanitize 在探测【前】：零已知打击者按 any_known 降级 SILENT（python 同序；"同刻发现可同刻被打"要求先验 anyKnown）；② slot 1 基础科技是 2 非 1（槽号≠科技值笔误）— 代价：无
Task 12: complete (tests: strike-fix 21/21——**验收门 1 通过**；全套 77/77；check 绿)
Task 12: Ruling: 队列再犯"重复垫 81"错（计划稿 Task 12 固定时引入）——击杀掷骰落位偏移致恒杀；修正为 makeEnv 外只垫 1296 — 代价：无（survive 分支当场揪出）
**M1 里程碑完成：引擎 12 阶段全实装，验收门 1（strike-fix）+ 门 2（守恒，全程断言）+ 门 5（quirk 锁）绿；门 3/4 待 M2 金标准。**

Task 13: complete (6 轨迹 + stats 录制成功：s1 250刻/933 draws/2.9MB、s2 250刻、mutual/shield/windup 定向精准命中、heat=稠密晚局 250刻；stats 0.3197/24.07/30ep；experiment __pycache__ 已清)
Task 13: Ruling: 轨迹格式扩展 **reset.patch**（声明式状态补丁：known/tech/res/pos/alive/free_pool/pending_spawns）— 定向场景需塑造状态而纯动作+RNG 不可得；补丁是数据，两端同序执行，回放保持确定 — 代价：TS 侧需 applyPatch（Task 14）
Task 13: Ruling: trace-tgt-heat 实际结局 = 稠密晚局（19 存活、t=250 done，非热寂）— 出生-死亡动态平衡；热寂 done 分支已由 resolve-c 单测覆盖，轨迹按"晚局经济覆盖"价值保留，README 如实披露 — 代价：无
Task 13: Ruling: stats 循环 beginTick→begin_tick 笔误修正（Python 侧）— 代价：无
Task 14: complete (tests: golden-replay **6/6 全绿**——验收门 3+4 通过；全套 83/83；check 绿)
Task 14: Ruling: 快照矩阵字段录制端**展平**（pos/known/observed/first_detect_tick 与 TS 平铺同形）— 计划未指定形状 — 代价：无
Task 14: Ruling: **stat-equivalence 测试延至 Task 18**（需 presets.ts；计划排序缺陷）— 代价：无
Task 14: Ruling: ReplayRng b64 解码用纯 atob（引擎浏览器安全，不引 node:Buffer）— 代价：无
Task 14 发现并修复 **3 处真实移植缺陷**（回放门的历史价值记录，详见 testdata/README.md）：
  ① 近邻块 feature-major 布局（np.concatenate(axis=-1) 列组拼接，非逐邻居 7 元组）
  ② 域内目标的近邻**几何保留**（big 不滤域内者；仅情报特征被 known_pair 掩蔽）——env-model 文档"非域"描述不精，代码为权威，CLAUDE.md 已知出入已登记
  ③ numpy _lerp 的 t≥0.5 分支（b−(b−a)·(1−t)）须照抄
**M2 里程碑完成：录制-回放金标准门通过——TS 引擎与 env2.py 等价性获得确定性证明（6 轨迹逐刻全状态精确比对 + 消耗序断言 + 守恒全程）。验收门 1-5 全绿（stat 第二口径待 Task 18 补）。**

Task 15: complete (12 模型 npz→JSON（main updates=149985，sweep 臂 37485）；dqn-outputs.json；next.config immutable 缓存头；check+build 绿)
Task 16: complete (catalog 2/2；沿用原型约定：模型标题=arm id 属数据展示非 i18n 文案)
Task 17: complete (dqn.test 4/4——**12 模型前向奇偶 |ΔQ|≤1e-9 一把过**；actBatch 消耗序同 model.py)
Task 18: complete (presets.test 4/4；stat-equivalence 1/1——10 局自跑在带宽内 + 守恒全程)
Task 18: Ruling: 测试笔误两处修正 — df 观测分支需打击【不】合法才可达（能打必打短路）；`valid[OBS] && uniform()` 短路使队列算术少一次掷（python `and` 同语义，实现正确）— 代价：无
**M3 里程碑完成：对手层就位（DQN 推理逐模型奇偶验证 + 预制策略 stage_b 口径 + 统计第二口径）。全套 94/94，check 绿。**

Task 19: complete (tests: match.test 6/6；全套 100/100；check 绿)
Task 19: Ruling: **席位登记重设计** — birth_log 只含内生出生（初始 cohort 不在其中）：初始 4 席于构造器显式登记（光标 0..3）；**首个内生出生 = 玩家**（= 出生序 4）；此后内生出生继续光标循环 — 计划的 nextOrdinal 计数把序 0 分给了对手（玩家错到 slot 8）且初始席从未登记（AI 全静止）— 代价：无（计划语义照旧，实现口径修正）
Task 19: Ruling: 测试编排两处物理错误修正 — ①全 SILENT 编排使互探熄火（×0.25 截面），改 DEVELOP；②漏算 t1 的第二次内生出生（slot5 在 t2 多弹一次 choice 吃掉目标脚本值）——编排=消耗序算术的教训再次生效 — 代价：无
Task 19: Ruling: env 增加 `get done()` 公共访问器（替代对私有 _done 的括号访问）— 代价：无
Task 20: complete (tests: view.test 7/7 + gates-parity 288 组合零违规；全套 108/108；check 绿)
Task 20: Ruling: **§7/词典新增提前至本任务**（原排 Task 22）— view.ts 产出 LogEntryView.key: MessageKey，键必须先存在才能编译；Task 22 只消费 — 代价：无
Task 20: Ruling: `log.blocked` → `log.ownStrikeBlocked` 重命名（感知规则①：仅玩家为打击者时报告），mock/event-log 引用同步改名；log.born 文案情报-free 化 — 代价：无
Task 20: Ruling: ViewTracker 契约 = **每刻至少一次 update()**（UI reducer 逐刻派发保证）；只处理最近未消费的 resolve — 跳刻漏事件 — 代价：需在 Task 22 的 reducer 中保证（测试已按契约调用）
Task 20: Ruling: 测试编排三处修正 — 逐刻出生再次咬人（AI 席数逐刻+1、目标队列相应延长）；"最后一行"断言改按键过滤（出生不断的世界里 slice(-1) 脆弱）；OBSERVE 平手取先含 slot 0（我两度忘记 slot 0 也是普通 AI）— 代价：无
Task 20: Ruling: `params.cause` 约定 = 携带 cause.* 键名，EventLog 嵌套翻译（view 层为纯 TS 无 t()）— 代价：EventLog 需实现一处嵌套翻译
Task 21: complete (/solo 多选 + ?op= 跳转；catalog 数据源；learner 预设卡移除——catalog 无此 id；check+build 绿)
Task 21: Ruling: page 文件的杂散 `export { isOpponentId }` 删除 — Next 对 page exports 有校验，跨页工具直接从 catalog 导入 — 代价：无
Task 22: complete (check/build/108 tests 全绿；生产冒烟：/match?op=df 200 且 demo 字样 0 处、/models/main.json immutable 头、/solo /online / 均 200；端到端会话冒烟 3 种子：won/dead/dead+stats 累计)
Task 22: Ruling: **useSearchParams 包 Suspense 外壳**（Next 16 预渲染要求，MatchConsole 拆内容组件）— 计划未预见 — 代价：无
Task 22: Ruling: MatchView 增加 **log 快照字段**（页面经 view 消费累计日志）+ SoloMatch 增加 **cancelRechoice()**（取消=保持本刻 pendingRe 锁定值，非上刻 last_action——计划的"submitRechoice(原动作)"口径不可靠）— 代价：无
Task 22: Ruling: 组件类型从 MockCiv 解耦为 **CivLike**（marker.tsx 定义、star-chart 消费；MockCiv/MarkerView 结构同构）— /online 的 mock 与 /match 的视图模型共用同一组件 — 代价：无
Task 22: Ruling: invasion-modal 增加 domainDisabled/domainTitle props（BD 重选的 tech 门在模态内禁用+理由行）；StatusPanel GATES→V23_CONFIG；end-overlay 三终态接 EndView — 代价：无
Task 22: Ruling: 浏览器交互手验移交 Task 23 的人工走查清单（无浏览器自动化工具；会话链路由引擎级 e2e 冒烟覆盖）— 代价：UI 细节问题留待用户走查反馈
Task 23: complete (CLAUDE.md 命令/路线/备忘更新；mock 收缩至 /online+legend；最终验证：bun test 108/108、check 零告警、build 静态预渲染、experiment/ 零改动)
Task 23: Ruling: mock.ts 注释中 `END_*/` 的 `*/` 序列会终止块注释（解析错误）— 改写为无斜杠表述 — 代价：无
Task 23: Ruling: 重复的 demo-bar 备忘行合并（旧"仅原型期存在"行删除，保留"已移除"行）— 代价：无

**M4+M5 完成：模式 (a) 单机端到端可玩。全部 23 任务完成。**

Final（用户手测回归，2026-10-08）: fixed 日志冻结在出生消息 — 两根因：
  ① view.ts update() 返回**同一数组引用**（this.log）——React Compiler 缓存元素，events 引用恒等 → EventLog 子树永不重渲染 → 修为快照拷贝 [...this.log]（view.test 新增引用契约用例 RED→GREEN，全套 109/109）
  ② client.ts 只在 start() 后才首次 update() → 排队态已过，waitBirth 从未发出 → 修为构造后先 update() 再 start()（v23 参数下排队恒为 1 刻：初始池 ≥70 > 预滚上限 20，玩家必在第 1 刻出生，无中间出生可漏——数学保证，无漏事件）
Final: Ruling: 该修复为用户手测发现、终审子代理因配额未执行前修复——终审提示词已交用户单开 session 执行（工作树全集评审，无 commit 基线）

## 终审（2026-10-08，用户单开 session 产出，报告存 docs/superpowers/reviews/2026-10-08-game-mechanics-final-review.md）

结论：Critical 0 / Important 1 / Minor 9；Ready to merge: **With fixes**。引擎逐阶段对照零语义漂移；
金标准门、感知过滤结构、边界守卫、gates 方向、stats 双端约定均被独立确认。

Final: fixed **Important 1**（黑域标记活值泄漏）— 新测试 "domain marker intel is FROZEN at the
windup tick end" RED（泄漏实证 6.1099 ≠ 封存 6.0999）→ GREEN；全套 110/110。
Final: Ruling: 快照点取**风窗刻末**而非评审建议的域生效刻 — env2.py:313 的 known_pair 只滤
~in_domain 不滤 windup：观测情报喂到声明刻末、域生效刻起才掩蔽 → 风窗刻末恰为 live 情报最后时刻，
快照精确（非近似）、比评审方案早一刻 — 代价：无（含跳刻安全网分支）
Final: fixed **Minor 1**（10 孤儿键 match.demo×6/opp.learner×2/actions.repeat/label.civ 删除，
grep 证实零引用；中途一次编辑误删 opp.random.name 已即时修复，tsc 校验通过）
Final: fixed **Minor 4**（experiment/__pycache__ 再清，find 计数 0）
Final: Ruling: M1+M4 随修复轮处理（超出 executing-plans 的"minors 不进修复轮"默认）— 评审 verdict
明确"随 Minor 1/4 一并处理后合入"且用户指示"再修"，视为授权 — 代价：无
Final: minor (deferred):
  M2 env.ts Math.hypot vs numpy norm 的 1-ulp 分歧——README 容差节应补披露行（再生成轨迹的
     潜在 flake 源，测度零）
  M3 globals.css anim-seal 死 CSS（@keyframes seal + .anim-seal 无引用；域标记无入场动画——UX 走查项）
  M5 client.ts 的 "use client" 指令越出计划约定集（冗余无害；删指令或 CLAUDE.md 纳入允许项）
  M6 match/page.tsx Suspense fallback 字面 "…"（i18n 流程的严格性 vs 语义中性占位）
  M7 view.ts invasion invader ?? 0 兜底假名 slot 0（不变式下不可达；破坏时错误归因 #0）
  M8 match.ts 魔法数 4/6 未用 A_INVADE/A_STRIKE 常量
  M9 match.ts byArm 循环内 env.obs() 逐臂重算（无害冗余）+ view.self.windup 已算未渲染（UX 走查项）
Final: 复盘（评审指出的计划层缺陷）：T20 未给"冻结情报"实现/测试任务（Important 1 根因）；
T22 清理清单漏列 demo 系词典键（Minor 1 根因）——未来计划的 §7/清理清单须全量枚举。

最终验证（2026-10-08）：bun test 110/110 · check 零告警 · build 静态预渲染 · experiment/ 零改动（pycache 0）。

Task 1: complete (tests: bun test → 1 pass；bun run check → 全绿 exit 0；@types/bun@1.4.2 装入 devDeps；无 commit——用户自管)
Task 2: Ruling: TickInfo 采用**元组形态**（与 env2.py info 字典/金标准轨迹逐位同形：`strike_events: [i,j,outcome,tech_i,tech_j,take][]` 等），而非计划草图中的对象形态 — 引擎层 parity 优先，人类工程学由 view 层承担 — 代价：expectInfoEqual 只需 loot_to 数组化，其余 toEqual 直比。
