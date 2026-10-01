# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目：黑暗森林网页游戏

本仓库包含两部分：

- `experiment/` —— **只读参考**：已完成的"黑暗森林法则多智能体强化学习验证"实验（纯 Python/numpy，
  Double-DQN 自博弈，v1.0→v2.3-fix 九个版本）。**禁止改动此目录下任何文件**；游戏所需的
  checkpoint 等数据以复制/引用方式取用。
- 仓库根 —— 游戏本体（Next.js + TypeScript，待开发）。

游戏定义（用户 2026-09-29 原始需求，勿走样）：

- 玩家扮演一个文明，在某个文明产生时出生（对应实验的"内生文明生成"机制），最终目标——**存活**。
- 模式 (a) **与智能博弈**：对手可选"已训练的模型"（DQN checkpoint）或"预制策略"
  （random / DF 启发式 / pacifist），均来自原实验。
- 模式 (b) **在线博弈**：不引入账号系统，所有在线用户一起排队入场，共享同一世界。
- **游戏环境必须是 v2.3-fix 实验环境的忠实移植**——一致性是硬要求，不是偏好。

## 硬性规则（用户指定，违反=返工）

1. **先理解后开发**：动任何游戏代码前，先读 `docs/env-model-v23.md` 与 `docs/ai-opponents.md`；
   两文档与代码冲突时，以 `experiment/experiment/env2.py` 为最终权威。
2. **UI 先行**：先写 `DESIGN.md`（设计系统/视觉规范），确认后产出 HTML 原型，最后实现；
   样式全程保持一致。
3. **UI 约束**：只用默认字体 + `monospace`；**不用 `<canvas>`**；克制使用动画，
   **坚决不用 JS 实现动画**（仅 CSS）。
4. **技术栈（已定，勿再议）**：bun + TypeScript + ESM + **Next.js** + Tailwind。
5. **运行时不引入 Python**：环境、DQN 推理、预制策略全部用 TS 重实现；Python 仅限
   开发期生成金标准测试数据。
6. **部署 Vercel**：注意缓存——在线模式 API 必须动态、禁缓存；checkpoint 等静态资产可长缓存。
   Vercel 无原生 WebSocket，在线模式用轮询/SSE + 共享状态存储实现。
7. 善用 plugin `typescript-lsp`。

## i18n（中英双语——用户硬需求，勿遗忘）

- 应用内中英双语，**默认回退英语**；**全站无手动语言切换控件**（用户 2026-09-30 明确决定，
  勿再添加任何语言开关/语言按钮）。
- 实现（零依赖，`src/i18n/`）：
  - `en.ts` = **类型源**：扁平键字典 `as const`，导出 `MessageKey`（全部键的字面量联合）与
    `Dict = Record<MessageKey, string>`；
  - `zh.ts: Dict` —— **缺键 = 编译错误**（`bun run check` 的 tsc 就是词典完整性测试）；
  - `index.tsx`：`I18nProvider` + `useI18n() → { locale, t }`；`t(key, params?)` 做 `{name}`
    插值，运行时兜底 `zh[key] ?? en[key] ?? key`。
- 语言解析（**仅在加载时确定一次**，会话内不变）：`?lang=zh|en`（命中即写 localStorage
  `lang`）> localStorage > navigator.language（`zh*` → zh，否则 en）。实现用
  `useSyncExternalStore`（server snapshot 恒 `en`，客户端 hydration 后解析）——
  **勿改回 `useState`+`useEffect`**（React Compiler lint 禁止 effect 内 setState，
  且会引起 hydration 闪烁）。
- 服务器端 metadata 恒 en；数字/坐标/时间格式**不做本地化**（mono 固定格式，见 DESIGN.md §7）。
- **新增 UI 文案的唯一流程**：先在 `DESIGN.md §7` 双语词汇表补行 → 同时补 `en.ts` 与 `zh.ts`
  → 再写组件。**组件层禁止任何硬编码的用户可见字符串**（双语硬写也不行，一律走字典）。
  键名按屏分组：`nav./home./solo./match./actions./log./modal./end./online./legend./opp./aria./label./cause.`。

## 权威口径（v2.3-fix）与事故警示

| 内容 | 权威来源 |
|---|---|
| 环境代码 | `experiment/experiment/env2.py`（含 2026-09-22 打击结算修复，629 行，`DarkForestEnv2` 单类参数化） |
| 环境参数 | `experiment/experiment/config_v23.yaml` |
| 回归测试 | `experiment/experiment/tests/test_strike_fix.py`（10 种子 × 击杀/守恒/护盾三断言） |
| 已训练模型 | `experiment/runs/v23_fix/seed42_main/checkpoint.npz`（主，600 回合自博弈）+ `experiment/runs/v23_fix_sweep_arms/<臂>/run/seed42_main/`（11 臂） |
| 评测产物 | `experiment/results/v23_fix/{stage_b,analysis,sweep}.json` |
| 实验结论 | `experiment/docs/experiment_report.md` 第六部分（391-430 行，v2.3-fix） |

- **2026-09-22 致命 bug**：v2.0–v2.3 旧环境"打击击杀只记事件、从不清除受害者 `alive` 标志"——
  被打击的文明实际存活。因此 `experiment/archive_incident_20260922/` 内**全部 v2.x 产物仅作事故档案**
  （旧路径名 runs_v23/、results_v23/ 等整理后只存在于档案内），绝不可作为游戏参数、结论或对手强度
  依据；报告第五部分就地保留但已作废。v1.x 数据不受影响（bug 自 v2 起）。
- **文档与代码的已知出入（一律以代码为准）**：
  ① 文档称黑域"风窗期可被打击"，实际 `env2.py:458-466,513-514` 中 `domain_windup` 同样免疫打击
  与入侵（风窗期只剩"可被探测"）；
  ② `env2.py:70` 注释"obs=36"已过时，实际 7+10+21=**38**；
  ③ `config_v23.yaml` 的 `develop_reward: 0.05` 未被 `resolve()` 使用（奖励走 `softsign_reward_scale`）；
  ④ `scripts/pipeline_v23_fix.sh` 注释"12 arms"实为 11 臂，且内含原沙箱硬编码路径（本机不可运行）。
- 参数来源：`softsign_a=0.2` 为用户指定且**至今未做敏感性扫描**的继承常数；`shield_cost_frac=0.5`
  用户指定但已在 sweep 中扫描（0.25/0.5/0.75 学习者存活 0.775/0.669/0.613，单调）。游戏如需改动
  任何环境参数，必须在设计文档中明示"这是对实验的偏离"。
- 口径纪律：跨版本/跨运行器比较统一 **stage_b 口径**；`analysis.json`（3 世界×40 ep）的动作画像/
  分箱与 `stage_b.json`（150 ep）的存活率不可混用；sweep 短臂（150 ep）仅可相对比较；v2.x 为
  单训练种子（42），引用任何数字必须带此披露。

## 环境模型速查（v2.3-fix；完整移植规格见 docs/env-model-v23.md）

- **世界**：[0,100)² **连续坐标**环面（"Grid"是历史名称，并非离散网格）；36 个**一次性**槽位
  （出生槽不复用，单局最多 36 次出生）；定长 250 刻结算；资源总预算 150 逐刻守恒
  （`总量 − Σ存活资源 − 自由池 ≡ 0`，以 info 字段报告残差而非 assert）。
- **出生**：初始 4 文明（tech~U[0.5,10]、res~U[5,20] 超预算则按比例缩放）；此后恒有**一个**预滚的
  下次出生资源 U[5,20]，自由池攒够即诞生（每刻至多 1 个、取最靠前空槽），出生科技按存活文明
  科技 P25–P75 抽取（最小跨度 1.0）。
- **动作（10 个，枚举序）**：

| # | 动作 | 门槛 | 时机 | 效果 |
|---|---|---|---|---|
| 0 | SILENT | 无 | 即时 | 被探测截面 ×0.25 |
| 1 | DEVELOP | 无 | 即时 | 科技 +0.05·(1−tech/10⁶)≈线性；奖励 +0.01·tech/(1+0.2\|tech\|) |
| 2 | BROADCAST_SELF | tech>1 或 res>10 | 下轮 | 自己坐标对全体可见（垂死者广播照常生效） |
| 3 | BROADCAST_OTHER | — | — | **已退役**，任何状态恒非法 |
| 4 | STRIKE | tech>7 且有已知目标 | 即时 | 显式目标，否则最近已知；p_kill=clip(0.55+0.12Δtech, 0.15, 0.95) |
| 5 | BLACK_DOMAIN | tech>5 | 下轮生效 | 不可逆；免疫探测/打击/入侵；增长×0.2、爆炸×0.1；入场 −0.5；域内仅可 DEVELOP/SILENT |
| 6 | INVADE | 有已知目标（无科技门槛） | 即时 | 必杀；掠夺受害者半数资源；受害者先获通知并可重选（反咬=互毁）；**无视护盾** |
| 7 | OBSERVE | tech>5 且有已知目标 | 即时+下轮 | 获最近已知目标精确 tech/res；下轮被一随机文明发现 |
| 8 | STRIKE_WEAK | tech>7 且有已知目标 | 即时 | 打已知最弱者（同一 p_kill 公式） |
| 9 | STRIKE_STRONG | tech>7 且有已知目标 | 即时 | 打已知最强者 |

- **护盾**：目标 tech ≥ 2× 打击者 → 打击被挡，目标损失自身资源 50% 入自由池（打击者零成本、不消耗 RNG）。
- **探测**：p = min(0.03·√tech_探测者 ×(0.25 若目标本刻 SILENT), 0.35)；探测者科技驱动概率，
  目标 SILENT 缩截面；环面距离 ≤30、未知对、双方存活；探测先于打击结算（同刻发现可同刻被打）。
  只知存在与位置，不泄露 tech/res（需 OBSERVE）；**已知永不遗忘、恒星位置永不变**。
- **经济**：流失 p=0.02/刻 损 U[0.5,2] 入自由池；res≤0 饿死（黑域内照常）；尸体余量入自由池；
  掠夺为转移不进池；科技爆炸 p=0.01/刻 ×U[1.6,2.2] 复合无上限（域内×0.1）。
- **每刻结算顺序**：域生效/入场 → 观测反曝光 → 延迟广播 → 被动探测 → 广播入队 → 打击（护盾/
  击杀置 alive=False）→ 入侵（反咬互毁+掠夺）→ 观测 → 发展/爆炸 → 流失/饿死 → 尸体结算 →
  奖励 → 内生出生 → t+=1。
- **终止**：t≥250，或热寂（全灭且自由池 < 下次预滚额）。无"最后幸存者即胜"判定——独存活者也要
  走满 250 刻；玩家目标是**活到终局**。
- **观测（38 维）**：7 自身标量（log1p(tech)/log1p(50)、res/20、已知存活数/(n−1)、存活占比、
  t/t_max、in_domain、windup）+ 10 上刻动作 one-hot + 3 个最近已知存活非域文明×7
  （Δx/50、Δy/50、d/50、log1p(tech) 或 −1、res/20 或 −1、public、in_domain 恒 0）；
  死亡行整行清零；float32。
- **驱动 API（两阶段 tick，无 step()）**：`select_targets(actions)` → `begin_tick(actions, targets)`
  （入侵者**当场**暴露给受害者）→ 受害者重选（人类玩家的关键交互点：被入侵时获得通知并重新决策；
  重选 INVADE=反咬互毁；重选 BLACK_DOMAIN 可当场取消入侵）→ `resolve(re_actions)`。
  `resolve` 返回的 info 事件流（detections/strikes/invasions/strike_events/loot_to/died_this_tick/
  strikes_blocked/free_pool/res_conservation_residual/n_births/n_alive/in_domain/counter_detections）
  是游戏渲染的直接数据源。

## AI 对手资产（完整规格见 docs/ai-opponents.md）

- **DQN**：纯 numpy MLP **[38,64,64,10]**（ReLU 隐层、He 初始化、线性输出，float64）。
  checkpoint（npz = 无压缩 ZIP 内嵌 .npy v1.0，小端 float64、C 序）键：
  `online__W0/b0/W1/b1/W2/b2` + `updates`（主 checkpoint=149985）。
  推理 = 前向 + 合法动作掩码 argmax（ε 探索同样只在合法动作内）；实验评测惯例 ε=0.05。
  无独立编码函数——直接用 env 的 `_obs()/_valid()`。
- **可用 checkpoint 共 12 个**（仅 v23_fix 系与现环境兼容）：主（600 回合自博弈）+ 11 个 sweep 臂
  （base_control 0.669 / shield025 0.775 / shield075 0.613 / scale005 0.747 / scale02 0.612 /
  budget100 0.683 / budget200 0.707 / lr3e4 0.618 / lr12e3 0.522 / gamma099 0.753 / gamma0999 0.580，
  池存活为 2 世界×40 ep 相对口径）。⚠️ 档案内 v2.0–v2.2s 的 checkpoint 为 36 维 obs/8 动作
  旧架构，与现环境不兼容，不可用。
- **预制策略**（`experiment/experiment/train2.py:40-52`，各运行器共享同一实现）：
  - `random`：合法动作均匀随机；
  - `df`（黑暗森林启发式）：STRIKE 一合法即打 → 30% OBSERVE → 60% DEVELOP 否则 SILENT；
    目标按 **stage_b 口径**：打击已知最强者（"诅咒领跑者"）、入侵最弱者；
  - `pacifist`：50% DEVELOP 否则 SILENT，永不攻击。
- **stage_b 口径**：36 槽 learner/random/df/pacifist 各 9（env seed 21001、agent seed 1001、
  ε=0.05、150 ep）；存活率 = alive_ticks/(250−spawn_tick)。
- **权威结论数字**（呈现对手强度时引用，须带单种子披露）：池存活 learner **0.627** > random 0.514 >
  df 0.418 > pacifist 0.369；learner 训练全程 600 回合**零打击**（画像 SILENT 0.525/DEVELOP 0.464，
  "科技竞速者"），牙齿仅用于入侵（0.19 次/回合，池中唯一有缴获者 loot 5.73）；df 5.2 打击/回合、
  场均 15.7 杀但零缴获——"教科书式森林=自杀"（森林真点燃，先发打击仍净害）。

## 常用命令

```bash
# 实验（本机已验证：Python 3.12.10 + numpy 1.26.4 + pyyaml 6.0.3；无 torch 依赖）
# ⚠️ 本机 Windows 默认编码 GBK，而 config 为 UTF-8：实验命令必须加 PYTHONUTF8=1（已实测否则 UnicodeDecodeError）
pip install -r experiment/experiment/requirements.txt     # numpy / pyyaml / matplotlib
PYTHONUTF8=1 python3 experiment/experiment/tests/test_strike_fix.py   # 打击修复回归（脚本自行 chdir；实测 REGRESSION PASS）

# v2.3-fix 复现（在 experiment/experiment/ 代码根执行；权威产物已存在，通常无需重跑）
OMP_NUM_THREADS=1 PYTHONUTF8=1 python3 train2.py --seed 42 --mode main --out ../runs/v23_fix --config config_v23.yaml
OMP_NUM_THREADS=1 PYTHONUTF8=1 python3 stage_b.py --run-dir ../runs/v23_fix/seed42_main --episodes 150 --out ../results/v23_fix --config config_v23.yaml
# ⚠️ scripts/pipeline_v23_fix.sh 内含原沙箱硬编码绝对路径（/home/z/...），本机不可直接运行，仅作历史脚本

# 游戏（仓库根，bun；已验证 2026-09-30）
bun run dev        # 开发服务器
bun run build      # 生产构建（4 路由静态预渲染）
bun run check      # typegen + eslint + tsc --noEmit（zh 词典完整性由 tsc 编译保证）
```

## 一致性验收（游戏环境 ⇄ 实验环境）

TS 环境移植完成的判定标准（全部通过才可接 UI）：

1. **test_strike_fix 等价**：10 种子 × {击杀置死+死因=strike、守恒残差≈0、护盾比≥2 精确挡下}
   在 TS 中复现。
2. **守恒不变量**：每刻 `总量 − Σ存活资源 − 自由池 ≡ 0`（|残差|≤1e-6），对局全程断言。
3. **金标准回放**：用 Python 环境按固定种子录制"动作序列 → 事件流/状态"轨迹，TS 逐刻比对。
   注意 numpy `default_rng` 为 PCG64 且消耗顺序数据依赖（位置拒绝采样次数可变）——逐位一致需
   移植 PCG64 并完全复刻调用序；推荐退一步用"确定性脚本用例逐刻比对 + 多世界统计等价"双口径，
   并在测试文档中写明口径。游戏运行时可用自身 RNG + 固定种子复现单局。
4. **info 事件流**字段语义与 `env2.py` `resolve()` 返回完全一致（游戏 UI 以此渲染）。
5. 移植时的已知quirk清单见 `docs/env-model-v23.md` §0（含出生站位拒绝采样读取旧位置、
   广播者 known[j,j] 自知、近邻块 in_domain 特征恒 0 等——影响 obs 逐位一致，须照抄）。

## 文档地图

| 文档 | 内容 |
|---|---|
| `docs/env-model-v23.md` | v2.3-fix 环境完整移植规格（参数/状态/出生/动作/公式/结算顺序/观测/事件流/RNG 策略/回归锁定） |
| `docs/ai-opponents.md` | DQN 推理移植 + 预制策略精确规则 + 12 个 checkpoint 清单与口径 |
| `DESIGN.md`（v0.2 已建） | UI 设计系统：方向/原则/令牌（v0.1）+ 双语词汇表 §7 + 组件规格 §10 + 五屏线框 §11 + i18n 规范 §12（无手动语言开关）+ 时序模型 §13（单机每刻暂停 / 在线定时刻长）。**写任何 HTML 前须先经它** |
| `experiment/README.md`、`experiment/INDEX.md` | 实验总览与目录地图 |
| `experiment/docs/experiment_report.md` | 实验总报告（第六部分 = 权威结论） |
| `experiment/docs/experiment_design.md`、`experiment/docs/data_contract.md` | 实验设计理由与 v1.x 数据契约 |

## 开发顺序（项目路线）

1. 环境移植 + 一致性验收（上节 1-5）→ 2. `DESIGN.md`（**v0.2 已完成 2026-09-30**，含 §13
   时序模型：单机每刻暂停回合制 / 在线 20s 定时刻、未提交默认静默）→ 3. HTML 原型
   （**已完成 2026-09-30**：`/` `/solo` `/match` `/online` 五屏静态 mock + 双语 i18n，
   `bun run check` + `build` 全绿）→ 4. 对手接入（DQN 推理 + 预制策略，模式 a）→
5. 在线模式（排队/共享世界/轮询或 SSE，模式 b）→ 6. Vercel 部署与缓存策略。
每阶段完成后更新 CLAUDE.md 的命令与状态。

落地备忘（2026-09-30 原型阶段；2026-10-01 更新）：

- **架构**：`layout.tsx`（server，持有 en metadata）→ `src/components/client-layout.tsx`
  （**唯一的应用级 `"use client"` 入口**：I18nProvider + 全局 side-effect 引入——当前为
  `@oddbird/popover-polyfill` 0.7.2，用户已装入 deps）。客户端边界之下的组件文件
  （`src/components/*` 其余部分）**不加** `"use client"` 指令——Next 16 会对入口文件做
  props 序列化检查、拒绝函数 props；页面组件与 ClientLayout 保留指令。
- **Popover 机制**（一切"详情浮层"的统一机制，2026-10-01 用户验证后扩展至 marker）：
  共享逻辑在 `src/components/use-auto-popover.ts` 的 `useAutoPopover`——悬停/聚焦 = 未钉住
  预览，点击 = 钉住/解开（selectable 标记则执行目标选取），`popover="auto"` 自带**全文档
  单开**、Escape 与轻触关闭（polyfill 于 client-layout.tsx 全局引入）。摆放两式：
  opponent-card = 包裹层 CSS 锚定 + anchor-positioning `position-try-fallbacks` + 打开时
  `translate` 钳制（`clampPopoverIntoViewport`）；marker = 星图 `overflow-hidden` 容器内，
  改用固定坐标 JS 摆放（`placeFixedPopover`：锚点下方、下方不足上翻、横向钳入视口）。
  **星图常驻数据标签已按此移除**（2026-10-01）：状态速读保留在形/色层，数字入浮层。
- 原型演示控制条（`/match` 的 demo bar：常规/弱小开局/入侵警报/终局×2）仅原型期存在，
  接入真实环境后移除。
