# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目：黑暗森林网页游戏

本仓库包含两部分：

- `experiment/` —— **只读参考**：已完成的"黑暗森林法则多智能体强化学习验证"实验（纯 Python/numpy，
  Double-DQN 自博弈，v1.0→v2.4 十个轮次；现为**符号链接指向的 git 仓库**，用户 2026-10-10 变更，
  便于追踪实验变化）。**禁止改动此目录下任何文件**；游戏所需的 checkpoint 等数据以复制/引用方式取用；
  Python 运行后无须清理其 `__pycache__`，因为其已添加至 gitignore。
- 仓库根 —— 游戏本体（Next.js + TypeScript，待开发）。

游戏定义（用户 2026-09-29 原始需求，勿走样）：

- 玩家扮演一个文明，在某个文明产生时出生（对应实验的"内生文明生成"机制），最终目标——**存活**。
- 模式 (a) **与智能博弈**：对手可选"已训练的模型"（DQN checkpoint）或"预制策略"
  （random / DF 启发式 / pacifist），均来自原实验。
- 模式 (b) **在线博弈**：不引入账号系统，所有在线用户一起排队入场，共享同一世界。
- **游戏环境必须是 v2.4 实验环境的忠实移植**（v2.3-fix 的后继轮次：观测优先信息原则 +
  同起跑线 + 四奖励臂，2026-10-09 spec）——一致性是硬要求，不是偏好。

## 硬性规则（用户指定，违反=返工）

1. **先理解后开发**：动任何游戏代码前，先读 `docs/env-model-v23.md`（已升版 v2.4）与
   `docs/ai-opponents.md`；两文档与代码冲突时，以 `experiment/experiment/env2_v24.py` 为最终权威。
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

## 权威口径（v2.4）与事故警示

| 内容 | 权威来源 |
|---|---|
| 环境代码 | `experiment/experiment/env2_v24.py`（654 行，`DarkForestEnv2` 单类参数化；v2.3-fix 链 env2.py 原样保留） |
| 环境参数 | `experiment/experiment/config_v24.yaml` + `experiment/runs/v24_arms/<臂>/config.yaml`（四臂 override） |
| 回归锚 | `experiment/experiment/tests/test_strike_fix.py`（v2.3-fix，打击逻辑未变）+ `experiment/experiment/smoke_v24.py`（v2.4 冒烟） |
| 已训练模型 | `experiment/runs/v24_arms/{a_classic,b_terminal,c_res,d_malintent}/run/seed42_main/checkpoint.npz`（各 600 回合自博弈，updates 149987；v2.3-fix 12 checkpoint 与现环境不兼容已退役） |
| 评测产物 | `experiment/results/v24_arms/`（四臂 stage_b.json + summary.json） |
| 实验结论 | `experiment/docs/experiment_report.md` 第七部分（v2.4）+ `experiment/reports/v24_arms_brief.md` |

- **2026-09-22 致命 bug**：v2.0–v2.3 旧环境"打击击杀只记事件、从不清除受害者 `alive` 标志"——
  被打击的文明实际存活。因此 `experiment/archive_incident_20260922/` 内**全部 v2.x 产物仅作事故档案**
  （旧路径名 runs_v23/、results_v23/ 等整理后只存在于档案内），绝不可作为游戏参数、结论或对手强度
  依据；报告第五部分就地保留但已作废。v1.x 数据不受影响（bug 自 v2 起）。
- **文档与代码的已知出入（一律以代码为准）**：
  ① 文档称黑域"风窗期可被打击"，实际 `domain_windup` 同样免疫打击与入侵（风窗期只剩"可被探测"）；
  ②（v2.4 已消解）v2.3 注释"obs=36"过时——v2.4 实为 7+8+21=**36**，注释与代码一致；
  ③ `config_v24.yaml` 的 `develop_reward: 0.05` 未被 `resolve()` 使用（奖励走 `softsign_reward_scale`）；
  ④ `scripts/pipeline_v23_fix.sh` 注释"12 arms"实为 11 臂，且内含原沙箱硬编码路径（本机不可运行）；
  ⑤ **近邻观测块**（2026-10-01 金标准回放发现；2026-10-11 v2.4 复核更新）：布局是
   **feature-major**——`np.concatenate(axis=-1)` 拼各 (n,3) 列组 → `[Δx×3, Δy×3, d×3, tech×3,
   res×3, public×3, in_domain×3]`（v2.4 索引自 15 起：15/18/21/24/27/30/33+k）；`big` 矩阵
   **不滤域内目标**（已知+存活的域内文明以真实几何进入，仅情报特征被 known_pair 掩蔽，
   in_domain 特征恒 0）。**Q13（v2.4 新发现）**：候选不足 3 时掩码行 tech/res/public 取
   argsort 第 k 位文明的旗标（known_pair/observed **距离无关**）——v2.3"补位槽内容确定"断言
   为侥幸，v2.4 揭露机制使 public 泄漏爆出；numpy argsort 平局序非稳定非索引序 → 已逐位移植
   numpy 1.26.4 introsort（`src/lib/engine/numpy-sort.ts`，Windows 轮子 MSVC 禁 SIMD 走标量
   aquicksort_；`testdata/argsort-vectors.json` 2005 矢量锁定；其他构建 AVX512 平局序不同——
   同为伪影）。
- 参数来源：`softsign_a=0.2` 为用户指定且**至今未做敏感性扫描**的继承常数；`shield_cost_frac=0.5`
  用户指定但已在 sweep 中扫描（0.25/0.5/0.75 学习者存活 0.775/0.669/0.613，单调）。游戏如需改动
  任何环境参数，必须在设计文档中明示"这是对实验的偏离"。
- 口径纪律：跨版本/跨运行器比较统一 **stage_b 口径**；`analysis.json`（3 世界×40 ep）的动作画像/
  分箱与 `stage_b.json`（150 ep）的存活率不可混用；sweep 短臂（150 ep）仅可相对比较；v2.x 为
  单训练种子（42），引用任何数字必须带此披露。

## 环境模型速查（v2.4；完整移植规格见 docs/env-model-v23.md）

- **世界**：[0,100)² **连续坐标**环面（"Grid"是历史名称，并非离散网格）；36 个**一次性**槽位
  （出生槽不复用，单局最多 36 次出生；**在线多生命世界例外**：`ONLINE_ENV_CONFIG.slotReuse`
  使 36 槽耗尽后复用已死槽——对实验的明示偏离，缺省世界保持忠实，2026-10-14）；定长 250 刻结算；资源总预算 150 逐刻守恒
  （`总量 − Σ存活资源 − 自由池 ≡ 0`，以 info 字段报告残差而非 assert）。
- **出生**：初始 4 文明（tech 恒 =tech_spawn_lo=1.0、res~U[5,20] 超预算则按比例缩放）；此后恒有
  **一个**预滚的下次出生资源 U[5,20]，自由池攒够即诞生（每刻至多 1 个、取最靠前空槽）。**v2.4
  无科技继承**：出生科技恒 1.0（同起跑线；v2.3 的 P25–P75 抽取已删，每出生少消耗 1 个 RNG 值）。
- **动作（10 个，枚举序）**：

| # | 动作 | 门槛 | 时机 | 效果 |
|---|---|---|---|---|
| 0 | SILENT | 无 | 即时 | 被探测截面 ×0.25 |
| 1 | DEVELOP | 无 | 即时 | 科技 +0.05·(1−tech/10⁶)≈线性；奖励 softsign·tech/(1+0.2\|tech\|) +（>0 时）res_reward·res |
| 2 | BROADCAST_ALL | tech>1 或 res>10 | 下轮 | 自己坐标对全体可见（垂死者广播照常生效；v2.4 改名自 BROADCAST_SELF） |
| 3 | BROADCAST_OTHER | 有已知存活非域目标 + tech>1 或 res>10 | 下轮 | **v2.4 恢复=揭露**：公开已知目标坐标给全宇宙，**发送者不暴露**（借刀杀人/归因歧义，Q14）；须显式目标；d 臂付 attack_reward |
| 4 | STRIKE | tech>7 且有已知目标 | 即时 | 显式目标，否则最近已知；p_kill=clip(0.55+0.12Δtech, 0.15, 0.95)；击杀认领付 attack_reward |
| 5 | BLACK_DOMAIN | tech>5 | 下轮生效 | 不可逆；免疫探测/打击/入侵；增长×0.2、爆炸×0.1；入场 −0.5；域内仅可 DEVELOP/SILENT |
| 6 | INVADE | 有已知目标（无科技门槛） | 即时 | 必杀；掠夺受害者半数资源（付 attack_reward）；受害者先获通知并可重选（反咬=互毁）；**无视护盾** |
| 7 | OBSERVE | tech>5 且有已知目标 | 即时+下轮 | **v2.4 显式选目标**（否则最近已知）；获目标精确 tech/res；下轮被一随机文明发现 |

（v2.4 删 STRIKE_WEAK/STRONG——按未观测科技排序=观测前作弊；N_ACTIONS 10→8、OBS_DIM 38→36。）

- **护盾**：目标 tech ≥ 2× 打击者 → 打击被挡，目标损失自身资源 50% 入自由池（打击者零成本、不消耗 RNG）。
- **探测**：p = min(0.03·√tech_探测者 ×(0.25 若目标本刻 SILENT), 0.35)；探测者科技驱动概率，
  目标 SILENT 缩截面；环面距离 ≤30、未知对、双方存活；探测先于打击结算（同刻发现可同刻被打）。
  只知存在与位置，不泄露 tech/res（需 OBSERVE）；**已知永不遗忘、恒星位置永不变**。
- **经济**：流失 p=0.02/刻 损 U[0.5,2] 入自由池；res≤0 饿死（黑域内照常）；尸体余量入自由池；
  掠夺为转移不进池；科技爆炸 p=0.01/刻 ×U[1.6,2.2] 复合无上限（域内×0.1）。
- **每刻结算顺序**：域生效/入场 → 观测反曝光 → 延迟公开（BALL 与揭露同式）→ 被动探测 →
  广播入队（先全 BALL 再全 BOTHER，两独立循环）→ 打击（护盾/击杀置 alive=False）→ 入侵
  （反咬互毁+掠夺）→ 观测（显式目标）→ 发展/爆炸 → 流失/饿死 → 尸体结算 → 奖励 → 内生出生 → t+=1。
- **终止**：t≥250，或热寂（全灭且自由池 < 下次预滚额）。无"最后幸存者即胜"判定——独存活者也要
  走满 250 刻；玩家目标是**活到终局**。
- **观测（36 维）**：7 自身标量（log1p(tech)/log1p(50)、res/20、已知存活数/(n−1)、存活占比、
  t/t_max、in_domain、windup）+ 8 上刻动作 one-hot + 3 个最近已知存活文明 × 7
  （Δx/50、Δy/50、d/50、log1p(tech) 或 −1、res/20 或 −1、public、in_domain 恒 0）；
  feature-major 布局（索引 15/18/21/24/27/30/33+k）；死亡行整行清零；float32；
  **候选不足 3 时掩码行特征 = argsort 第 k 位文明的旗标（Q13，numpy-sort.ts 逐位复刻）**。
- **驱动 API（两阶段 tick，无 step()）**：`select_targets(actions)` → `begin_tick(actions, targets)`
  （入侵者**当场**暴露给受害者）→ 受害者重选（人类玩家的关键交互点：被入侵时获得通知并重新决策；
  重选 INVADE=反咬互毁；重选 BLACK_DOMAIN 可当场取消入侵）→ `resolve(re_actions)`。
  `resolve` 返回的 info 事件流（detections/strikes/invasions/strike_events/loot_to/died_this_tick/
  strikes_blocked/free_pool/res_conservation_residual/n_births/n_alive/in_domain/counter_detections）
  是游戏渲染的直接数据源。

## AI 对手资产（完整规格见 docs/ai-opponents.md）

- **DQN**：纯 numpy MLP **[36,64,64,8]**（ReLU 隐层、He 初始化、线性输出，float64；维度自权重
  推导）。checkpoint（npz = 无压缩 ZIP 内嵌 .npy v1.0）键：`online__W0/b0/W1/b1/W2/b2` +
  `updates`（四臂均 149987）。推理 = 前向 + 合法动作掩码 argmax（ε 探索同样只在合法动作内）；
  评测口径 ε=0.05（stage_b_v24）；参谋路径 `dqn.act` ε=0 零 RNG。
- **可用 checkpoint 共 4 个**（仅 v2.4 奖励臂，`experiment/runs/v24_arms/<臂>/run/seed42_main/`）：
  `a_classic`（无覆盖）/ `b_terminal`（soft 0、bd 0）/ `c_res`（+res 0.0025）/
  `d_malintent`（c + attack 0.5）。⚠️ v2.3-fix 的 12 个（38 维 obs/10 动作）与档案内 v2.0–v2.2s
  均不兼容，已从游戏对手目录退役。
- **预制策略**（`experiment/experiment/train2_v24.py:40-52`，各运行器共享同一实现）：
  - `random`：合法动作均匀随机（v2.4 合法集含揭露）；
  - `df`：STRIKE 一合法即打 → 30% OBSERVE → 60% DEVELOP 否则 SILENT；目标按 **stage_b_v24 口径**：
    INVADE 选候选最弱（安全猎杀）、其余目标动作选候选最强（"诅咒领跑者"）；
  - `pacifist`：50% DEVELOP 否则 SILENT，永不攻击。
- **stage_b_v24 口径**：36 槽 learner/random/df/pacifist 各 9（env seed 21001、agent seed 1001、
  ε=0.05、150 ep）；分层变量 = **peak_tech**（earned tech；无继承后 spawn_tech 退化）。
- **权威结论数字**（引用须带单种子 42 + 150ep 披露；v2.4 池生态反转）：pacifist 0.51–0.58 **四臂
  全居首** > df 0.46–0.52 > learner 0.30–0.48（a 0.478 / b 0.342 / c 0.376 / d 0.296）> random
  0.05–0.07；learner 全臂零打击（牙齿=揭露+入侵）：a 静默 0.62+种田 0.36；b 纯静默 0.82；c 掠夺流
  入侵 11.1/ep loot 59.5；d 信息战揭露 0.181。earned-tech 分层 high 0.83–0.92 ≫ low 0.13–0.18
  （发展优势从"出生特权"变为"努力回报"）。跨版本数字不可比（机制+参数双重变化）。

## 常用命令

```bash
# 实验（本机已验证：Python 3.12.10 + numpy 1.26.4 + pyyaml 6.0.3；无 torch 依赖）
# ⚠️ 本机 Windows 默认编码 GBK，而 config 为 UTF-8：实验命令必须加 PYTHONUTF8=1（已实测否则 UnicodeDecodeError）
pip install -r experiment/experiment/requirements.txt     # numpy / pyyaml / matplotlib
PYTHONUTF8=1 python3 experiment/experiment/tests/test_strike_fix.py   # 打击修复回归（脚本自行 chdir；实测 REGRESSION PASS）

# v2.4 复现（在 experiment/experiment/ 代码根执行；权威产物已存在，通常无需重跑）
OMP_NUM_THREADS=1 PYTHONUTF8=1 python3 run_v24_arms.py    # 四臂幂等驱动（train + stage_b）
PYTHONUTF8=1 python3 smoke_v24.py                           # v2.4 冒烟
# v2.3-fix 历史链（env2.py/train2.py/stage_b.py）原样保留，勿在游戏侧引用
# ⚠️ scripts/pipeline_v23_fix.sh 内含原沙箱硬编码绝对路径（/home/z/...），本机不可直接运行，仅作历史脚本

# 游戏（仓库根，bun；已验证 2026-10-11 v2.4 同步轮）
bun run dev        # 开发服务器
bun run build      # 生产构建（/ 等页面静态预渲染 + 4 个 /api/online/* 路由动态）
bun run check      # typegen + eslint + tsc --noEmit（zh 词典完整性由 tsc 编译保证）
bun test           # 全部测试（引擎金标准回放/argsort 矢量 + 对手奇偶 + 单机会话/感知/门 parity/奖励/配置 + 在线层记录/驱动/窗口机器/服务；214 用例 ~1.4s）
bun run purge:online  # 手动清 Upstash 在线命名空间 df:online:*（dev 卫生；产线世界持久永不清）

# 金标准与模型资产的再生成（开发期 Python，只读引用 experiment/ 的 *_v24 模块）
PYTHONUTF8=1 python3 scripts/golden/record_golden.py        # 7 轨迹 + stats.json → src/lib/engine/testdata/
python3 scripts/golden/convert_models.py                   # 4 臂 npz → public/models/*.json（immutable 长缓存）
python3 scripts/golden/record_dqn_outputs.py               # 4 模型前向奇偶数据 → testdata/dqn-outputs.json
# 轨迹自带 meta.cfg（奖励臂轨迹用其训练参数录制）；argsort 平局序矢量 = testdata/argsort-vectors.json
# 口径与容差披露见 src/lib/engine/testdata/README.md（缺陷史 + Q13 掩码行伪影 + TS-only rewardDetail）
```

## 一致性验收（游戏环境 ⇄ 实验环境）

TS 环境移植完成的判定标准（全部通过才可接 UI）：

1. **test_strike_fix 等价**：10 种子 × {击杀置死+死因=strike、守恒残差≈0、护盾比≥2 精确挡下}
   在 TS 中复现。
2. **守恒不变量**：每刻 `总量 − Σ存活资源 − 自由池 ≡ 0`（|残差|≤1e-6），对局全程断言。
3. **金标准回放**（已落地）：`scripts/golden/record_golden.py` 录制 env2_v24 每次 RNG 调用 +
   逐刻全状态快照（7 轨迹，含 d 臂奖励参数路径）→ TS `ReplayRng` 逐条断言消耗序后重演 →
   全状态/obs/info/rewards 精确比对 + 守恒全程 + `assertExhausted`。**v2.4 增补**：近邻块 argsort
   平局序逐位复刻（numpy-sort.ts + 2005 矢量）；轨迹 meta.cfg 自带 env 参数。游戏运行时用
   自身 RNG（sfc32）+ 固定种子复现单局。
4. **info 事件流**字段语义与 `env2_v24.py` `resolve()` 返回完全一致（游戏 UI 以此渲染）。
5. 移植时的已知quirk清单见 `docs/env-model-v23.md` §0（含出生站位拒绝采样读取旧位置、
   广播者 known[j,j] 自知、近邻块 in_domain 特征恒 0 等——影响 obs 逐位一致，须照抄）。

## 文档地图

| 文档 | 内容 |
|---|---|
| `docs/env-model-v23.md` | **v2.4** 环境完整移植规格（已升版 2026-10-11：参数/状态/出生/动作/公式/结算顺序/观测/事件流/RNG 策略/Q13-Q14/四臂奖励）——文件名保留 v23 属历史命名 |
| `docs/ai-opponents.md` | DQN 推理移植（36/8）+ 预制策略精确规则 + v2.4 四奖励臂清单与画像 |
| `docs/online-architecture.md` | **在线模式架构**（2026-10-14）：tick-in-flight 时序模型、确定性重演持久化（WorldRecord/花名册/配对档案）、Upstash 键布局与带宽预算（idx 微型 GET + 实例缓存）、AI 决策平价披露、线协议、已接受边界、模块地图。做在线模式任何工作前先读它 |
| `docs/game-mechanics.md` | **游戏机制阶段设计**（2026-10-01，v1.0）：模块架构（engine/opponents/solo 分层）、Rng 接口（uniform/choice）+ 录制-回放金标准、5 点验收门的测试落地、模型预转换 JSON 管线、单机会话层（座位分配/玩家出生/逐刻循环）、**玩家感知过滤规则表**（严格忠实口径）、里程碑 M1-M5。做引擎/对手/会话任何工作前先读它 |
| `DESIGN.md`（v0.2 已建） | UI 设计系统：方向/原则/令牌（v0.1）+ 双语词汇表 §7 + 组件规格 §10 + 五屏线框 §11 + i18n 规范 §12（无手动语言开关）+ 时序模型 §13（单机每刻暂停 / 在线定时刻长）。**写任何 HTML 前须先经它** |
| `experiment/README.md`、`experiment/INDEX.md` | 实验总览与目录地图 |
| `experiment/docs/experiment_report.md` | 实验总报告（第六部分 = 权威结论） |
| `experiment/docs/experiment_design.md`、`experiment/docs/data_contract.md` | 实验设计理由与 v1.x 数据契约 |

## 开发顺序（项目路线）

1. 环境移植 + 一致性验收（**已完成 2026-10-02**：TS 引擎，验收门 1-5 全绿）→
   **v2.4 同步（2026-10-11 完成）**：env2_v24 移植（8 动作/36 obs/揭露/无继承/奖励臂）+
   金标准 7 轨迹重录 + numpy argsort 逐位移植（Q13）+ 对手层 4 臂 + 单机层 cfg 注入/
   奖励展示/模型参谋/配置面板（用户 2026-10-10 需求）→
2. `DESIGN.md`（v0.2 完成 2026-09-30；2026-10-09/10-10 UX 轮 + v2.4 词汇/组件规格增补）→
   3. HTML 原型（**已完成 2026-09-30**）→ 4. 对手接入（**已完成 2026-10-02**；v2.4 化 2026-10-11：
   DQN 4 臂前向奇偶 + 预制 8 动作集 + 单机会话与感知过滤含揭露规则⑫）→
5. 在线模式（**已完成 2026-10-14**：共享世界 + 排队 + 轮询——tick-in-flight 时序（beginTick 开窗/resolve 关窗）、确定性重演持久化（记录只存人类输入）、Upstash Redis 存储（EVAL 原子 CAS/锁、心跳独立键）、服务端感知过滤（view.ts 适配器复用）、四臂轮替 AI 居民、追赶/心跳剪除/世界滚动；机制文档 `docs/online-architecture.md`）。2026-10-14
   round-2（用户裁定：AI 一等公民/多次进出重排）：**无快进**（刻长恒定，仅无人且队空惰性冲刺）、
   行动格执行钮移除（选择即提交 + 刻末 2s 安全网，silent 未提交不发包）、**槽复用**
   （`ONLINE_ENV_CONFIG.slotReuse`——对 v2.4 的明示偏离，缺省关闭保金标准忠实；tracker
   感知缓存随 known 列重置清除）、**死席再排队 = 每命一新 token**（服务端换发，配对档案恒一致）→
6. Vercel 部署与缓存策略（`/models/*` immutable 头已就位；在线 API 已是 force-dynamic + no-store，待整体部署验证：Upstash env 在 Vercel 配置、函数时限内冷重演 ~0.5s）。
每阶段完成后更新 CLAUDE.md 的命令与状态。

落地备忘（2026-09-30 原型阶段；2026-10-02 机制阶段；2026-10-11 v2.4 同步轮；2026-10-14 在线模式轮）：

- **游戏机制分层**（docs/game-mechanics.md §1）：`src/lib/engine/`（纯 TS 环境，零 React；
  numpy-sort.ts = argsort 逐位移植）→ `src/lib/opponents/`（dqn.ts 前向+actBatch+act /
  presets.ts / catalog.ts 合并目录）→ `src/lib/solo/`（match.ts 会话状态机 + view.ts 感知过滤 +
  rewards.ts 奖励组合 + cfg-io.ts 配置 IO + gates.ts 门理由 + client.ts 装配）。
  **Rng 为构造期注入**（env 不持有种子）：GameRng=运行时 sfc32、ScriptedRng=单测脚本值
  （原样返回，非缩放）、ReplayRng=金标准回放。种子派生 `seedOf(S, domain)`（splitmix64）：
  domain ∈ "env" / "session"（预制共享流，stage_b 口径）/ "model:" + arm。
  座位约定：初始 4 席 = 对手光标 0..3；**首个内生出生 = 玩家**（出生序 4）；此后继续光标循环。
- **UI 只可消费 view.ts 视图模型**（MatchView）：感知过滤（严格忠实口径，规则表 game-mechanics.md
  §7——他人间交锋/被观测反曝光/被打击幸存/**被揭露**均不渲染，规则①-⑫）在 ViewTracker 内完成，**组件层禁止直读
  env/SoloMatch**。ViewTracker 契约：每刻至少一次 update()。日志 `params.cause` 携带 cause.* 键名，
  由 EventLog 嵌套翻译。
- **在线模式分层**（2026-10-14，docs/online-architecture.md）：`src/lib/online/`（record/driver/hub/service/store（memory+upstash）/http/server/use-online-world）+ `src/app/api/online/{queue,state,action,rechoice}`。世界记录**只存人类输入**（种子+逐刻提交/重选+花名册+**加入时刻**+配对），载入全量重演（AI 动作确定性推导）；锁/键/心跳见架构文档 §3；驱动测试接缝 = afterResolve（resolve 后、beginTick 前）与 stashBasisTick（决策基线）。
- **模型资产**：`public/models/<arm>.json`（**v2.4 四臂**：a_classic/b_terminal/c_res/d_malintent，
  npz 预转换，Python float repr↔JSON.parse 逐位往返），next.config 已挂 immutable 长缓存，运行时
  按需 fetch。`/match?op=<逗号分隔 id>`（预制 3 + 臂 4 **合并单一列表**，2026-10-10 用户修订——
  对手卡内联动作画像、无 popover、无胜率），非法参数/加载失败 → replace /solo。
- **环境配置（2026-10-10 用户需求）**：`/solo` 开局前可配置世界常量（`cfg-io.ts` 精选 25 参数 +
  出生科技；默认恒 = config_v24，改动即明示偏离）；差集经 sessionStorage 传递，读取端钳制 +
  忽略未知键；SoloMatch 构造注入 cfg。**奖励展示**（配置流 + 四臂固定参数对比）与**模型参谋**
  （四臂 greedy 零 RNG；用过即终局披露）走 `TickResult.rewardDetail`（TS-only 诊断，不进 info、
  不参与 parity）与 `dqn.act`；机制见 game-mechanics.md §7.1。
- useSearchParams 必须包 Suspense 外壳（Next 16 预渲染；/match 的 MatchConsole 模式）。
- 组件层标记类型 = **CivLike**（marker.tsx 定义）：MockCiv 已退役；/online 大厅 mock 亦随在线真实接线退役（2026-10-14）——
  mock.ts 只剩 legend-hero 标本。
- 原型演示控制条（/match demo bar）**已移除**（2026-10-02，真实环境接线时）。

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
