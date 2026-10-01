# DarkForestGrid v2.3-fix 环境移植规格（Python → TypeScript 权威对照）

> **用途**：网页游戏对实验环境的忠实移植规格。一切以代码为准：
> `experiment/experiment/env2.py`（629 行，类 `DarkForestEnv2`）+ `experiment/experiment/config_v23.yaml`。
> 本文所有行号均指 env2.py（2026-09-22 打击结算修复版）。
> 配套：`docs/ai-opponents.md`（DQN 推理与预制策略）。CLAUDE.md 为总入口。

## 0. 移植原则与已知陷阱（quirk 清单）

**原则**：文档（含 experiment/README.md 与 experiment_report.md 的机制描述）与代码冲突时，**一律以
env2.py 为准**。历史背景：v2.0–v2.3 存在"打击击杀不清 alive"的结算 bug，09-22 修复（env2.py:498-506）
后即 v2.3-fix——唯一权威口径；修复前产物全部封存于 `experiment/archive_incident_20260922/`。

移植时必须**照抄**的已知 quirk（影响 obs 逐位一致与行为等价）：

| # | quirk | 位置 | 说明 |
|---|---|---|---|
| Q1 | 出生站位拒绝采样读取**上一局**的 `self.pos` | env2.py:170-177 | 首次 reset 时 `hasattr(self,"pos")` 为 False → 全 ∞ → **完全不生效**；后续 reset 按旧位置判定。精确移植=复刻此行为；若游戏选择修复（真正保证初始两两距离≥12），须在 DESIGN 文档标注偏离 |
| Q2 | 广播者"自知" | env2.py:422-424 | `known[alive, j]=True` 使广播者 `known[j,j]=True`：已知占比 obs 特征 +1/(n−1)，且可使 strikeable 仅因"知道自己"而为真（自打击因对角 ∞ 而 fizzles，无害） |
| Q3 | 近邻块 in_domain 特征恒 0 | env2.py:313,327 | `known_pair` 排除域内目标，而 in_domain 特征 = `in_domain[target]×known_pair` → 恒 0。照抄实现（恒 0）以保 obs 一致 |
| Q4 | 风窗期不可被打击/入侵 | env2.py:458-466,513-514 | 文档称"风窗期可被打击"是错的：`domain_windup` 目标被打击/入侵掩码排除。风窗期只剩"仍可被探测"（env2.py:432 只清 in_domain 列） |
| Q5 | 守恒"断言"实为 info 字段 | env2.py:623 | `res_conservation_residual` 是每刻报告的残差，外部按 \|·\|≤1e-6 检验；env2.py 内没有 Python assert |
| Q6 | `develop_reward` 是死参数 | env2.py:102,139 vs 594-603 | config 的 0.05 从未被 resolve 使用；奖励只走 `softsign_reward_scale` |
| Q7 | `exists` property 无人引用 | env2.py:219-222 | `alive & (t≥spawn_tick)`；全部逻辑只看 `alive`。TS 可不实现 |
| Q8 | `_obs` 中 `crowd` 计算后未使用 | env2.py:292 | v1.x 领土拥挤遗留，无效果 |
| Q9 | 反咬不需要合法目标 | env2.py:515-523 | 被入侵者重选动作=INVADE 即触发互毁，环境不看目标是谁 |
| Q10 | 反击入侵仍会暴露 | env2.py:354-359 | 入侵通知在 begin_tick 即发生；受害者即便当场声明黑域取消入侵，入侵者已被知晓（白暴露） |
| Q11 | 槽位一次性 | env2.py:233 | 出生只取 `spawn_tick>1e8` 的最靠前空槽；死后槽位**不复用** → 单局最多 36 次出生（含初始 4） |
| Q12 | 阻挡的打击不消耗 RNG | env2.py:484-490 | 护盾判定在 p_kill 抽签**之前** continue；见 §12 消耗序 |

另注意：世界是 **[0,100)² 连续坐标**（"Grid"为历史名称，并非离散网格）；恒星位置永不改变；
`known` 一旦置位永不遗忘。

## 1. 参数表（config_v23.yaml 全量 + env2.py 默认值）

### env 参数（config_v23.yaml:17-52；构造函数 env2.py:76-151）

| 参数 | v2.3 值 | env2.py 默认 | 语义 |
|---|---|---|---|
| `n_agents` | 36 | 12 | 槽位数（一次性，见 Q11） |
| `world` | 100.0 | 100.0 | 世界边长；坐标连续，环面 |
| `detect_radius` | 30.0 | 30.0 | 探测/近邻块半径（硬截断，无衰减） |
| `t_max` | 250 | 250 | 定长刻数 |
| `p_detect_base` | 0.03 | 0.03 | 探测基础概率系数 |
| `stealth_mult` | 0.25 | 0.25 | 目标 SILENT 时截面缩减 |
| `p_detect_max` | 0.35 | 0.35 | 探测概率上限（tech≈136 时触顶） |
| `p_explosion` | 0.01 | 0.01 | 每刻科技爆炸概率（域内 ×`bd_explosion_mult`） |
| `develop_rate` | 0.05 | 0.05 | 线性增长系数 |
| `tech_cap` | 1e6 | 10.0 | 名义上界（v2.3 特意放大 → 实际线性） |
| `tech_spawn_lo/hi` | 0.5 / 10.0 | 同 | 初始科技 U[lo,hi]；出生科技回退区间 |
| `kill_base` | 0.55 | 0.55 | p_kill 基数 |
| `kill_tech_slope` | 0.12 | 0.12 | p_kill 科技差斜率 |
| `res_min/res_max` | 5.0 / 20.0 | 同 | 出生资源 U 区间；obs 中 res 归一化分母=res_max |
| `res_total_budget` | 150.0 | 150.0 | 守恒总量 |
| `shield_cost_frac` | 0.5 | 0.5 | 护盾挡击时目标资源耗散比例 |
| `softsign_a` | 0.2 | 0.2 | Softsign 形状系数（**未扫描的继承常数**） |
| `softsign_reward_scale` | 0.01 | 1.0 | 科技奖励量级（渐近 0.05/tick，保死亡惩罚回报级支配） |
| `p_deplete` | 0.02 | 0.02 | 每刻自然流失概率 |
| `deplete_lo/hi` | 0.5 / 2.0 | 同 | 流失量 U 区间 |
| `gate_broadcast_tech` | 1.0 | 1.0 | 广播科技门槛（严格 >） |
| `gate_broadcast_res` | 10.0 | 10.0 | 广播资源门槛（严格 >） |
| `gate_observe_tech` | 5.0 | 5.0 | OBSERVE 门槛 |
| `gate_domain_tech` | 5.0 | 5.0 | BLACK_DOMAIN 门槛 |
| `gate_strike_tech` | 7.0 | 7.0 | 打击门槛 |
| `develop_reward` | 0.05 | 0.05 | **死参数**（Q6），仅为 Softsign 渐近值的语义说明 |
| `death_penalty` | 10.0 | 10.0 | 死亡惩罚 |
| `bd_entry_penalty` | 0.5 | 0.5 | 黑域入场瞬时惩罚 |
| `bd_growth_mult` | 0.2 | 0.2 | 域内增长倍率 |
| `bd_explosion_mult` | 0.1 | 0.1 | 域内爆炸概率倍率 |
| `enable_black_domain` | true | True | 黑域开关 |
| `spawn_schedule` | [[0,4]] | [(0,12)] | **只用第一项**：初始 4 文明；后续出生纯池驱动（env2.py:186） |

### 模型/训练/评测参数（config_v23.yaml:54-77；不属于环境，仅供复现）

`model`: obs_dim 38、n_actions 10、hidden [64,64]；`train`: episodes 600、γ 0.995、lr 6e-4、
batch 128、replay 150k、update_every 2（**train2 未使用**，每 tick 固定一次 update）、target_sync 2000、
ε 1.0→0.05（前 50% 回合退火，按 tick 细分）、seeds [42]；`eval`: episodes 150、ε 0.05。

### 代码内派生常数

`NEAR_K=3`（env2.py:69）；`OBS_DIM = 7+N_ACTIONS+NEAR_K*7 = 38`（env2.py:70，行内注释"36"过时）；
`LOG_REF = log1p(50)`（env2.py:297）；近邻 Δ、d 归一化分母 50；res 归一化分母 res_max=20；
初始站位最小距离 12.0（Q1）；出生科技最小跨度 1.0（env2.py:244）；未出生标记 `spawn_tick=10^9`。

### v2.3 相对 v2.2 的行为差异（代码写死、非 config 可切换，env2.py:59-70,197-198,478-480,562）

① 36 槽一次性 + 单预滚出生队列；② 增长回到 `develop_rate·(1−tech/cap)` 线性形式（cap 放大）；
③ 广播仅剩 BROADCAST_SELF（BOTHER 索引保留恒非法）；④ 打击三模式选目标 + 显式坐标；
⑤ 09-22 击杀修复。旧 config 在现 env2.py 上跑出的是混合体（如 v2.1 多批次 schedule 失效），勿混用。

## 2. 世界与状态字段（reset，env2.py:164-216）

| 字段 | 形状/类型 | 初值 | 语义 |
|---|---|---|---|
| `pos` | (n,2) float | uniform(0,100)（Q1 的"拒绝采样"实际失效） | 恒星位置，永不移动 |
| `tech` | (n,) float | 前 n0 个 ~U[0.5,10]，其余 0 | 科技，无上界 |
| `res` | (n,) float | 前 n0 个 ~U[5,20]，若总和>150 整体按 150/Σ 缩放（env2.py:191-192）；其余 0 | 资源；掠夺后可>res_max |
| `alive` | (n,) bool | 前 n0 True | 存活；死后永 False（槽不复用） |
| `spawn_tick` | (n,) int | 前 n0 为 0，其余 10⁹ | 出生刻；出生时记 `t+1` |
| `spawn_tech/spawn_res` | (n,) | 出生值快照 | 仅供分析分层（tech_class：<3.5 low、<7 mid、≥7 high，data2.py:68-73） |
| `known` | (n,n) bool | 全 False | `known[i,j]`=i 知道 j 存在；**永不遗忘** |
| `observed` | (n,n) bool | 全 False | `observed[i,j]`=i 对 j 有精确 tech/res 情报（OBSERVE 所得） |
| `public` | (n,) bool | 全 False | j 的坐标已广播给全体 |
| `in_domain` | (n,) bool | 全 False | 黑域生效（不可逆） |
| `domain_windup` | (n,) bool | 全 False | 本刻已声明，下刻生效 |
| `last_action` | (n,) int | 全 A_SILENT(0) | 上刻**生效后**动作（eff）；obs one-hot 来源 |
| `first_detect_tick` | (n,n) int | 全 −1 | i 首次得知 j 的刻；由被动探测/反曝光/入侵通知写入，**广播不写**（env2.py:422-424） |
| `death_cause` | (n,) str | "" | `strike/invade/mutual/starve`（train2 自己的 metrics 用 invasion/resource 命名，勿混淆） |
| `peak_tech` | (n,) float | 出生值 | 存活期最高科技（分析用） |
| `free_pool` | float | 150 − Σres₀ | 自由资源池 |
| `pending_spawns` | list[float] | [uniform(5,20)] | **恒恰好一个**预滚出生资源 |
| `birth_log` | list | [] | (tick, slot, spawn_res) |
| `pending_reveal` | list | [] | 延迟广播队列 (kind, j) |
| `pending_counter` | list | [] | 上刻 OBSERVE 者的待曝光队列 |
| `t` | int | 0 | 当前刻 |

`exists` = `alive & (t≥spawn_tick)`（Q7，未用）。初始 n0 = spawn_schedule[0][1] = 4。

## 3. 出生机制（_activate_pending_spawns，env2.py:224-254）

每刻结算**末尾**调用（resolve 步骤 10），每刻至多 1 个：

1. 队列空 / `free_pool < pending_spawns[0]` / 无空槽（`spawn_tick>10⁸` 的最靠前者）→ 不出生。
2. `spawn_res = pending_spawns.pop(0)`；**立即**预滚下一个 `uniform(5,20)` 入队（队列永不清空）。
3. 出生科技校准：存活≥2 → `lo,hi = np.percentile(alive_tech, [25,75])`（**numpy 线性插值百分位，
   TS 须等价实现**）；否则回退 `lo,hi = 0.5,10`。若 `hi−lo < 1.0`：`mid=(lo+hi)/2`，`lo,hi = mid±0.5`。
   `tech[slot] = uniform(lo, hi)`（**不裁剪到 [0.5,10]**）。
4. `res[slot]=spawn_res`；`free_pool -= spawn_res`；`spawn_tick[slot]=t+1`（下一刻起可行动）；
   `alive[slot]=True`；birth_log 记 `(t+1, slot, spawn_res)`。

初始 4 文明在 t=0 直接 alive（科技/资源见 §2）。**出生时点退化**：当前参数下初始自由池约
92→100，后续文明集中在前 ~10 刻内出生；游戏中若要拉长"排队入场"时间跨度，须调
`res_total_budget`/出生成本并明示偏离（或利用"每刻至多 1 个出生"的节流）。

## 4. 动作空间与合法性掩码

### 动作枚举（env2.py:59-67，索引固定）

```
0 SILENT   1 DEVELOP   2 BROADCAST_SELF   3 BROADCAST_OTHER(退役,恒非法)
4 STRIKE   5 BLACK_DOMAIN   6 INVADE   7 OBSERVE   8 STRIKE_WEAK   9 STRIKE_STRONG
```

### `_valid()`（env2.py:257-286）逐条规则（TS 必须等价）

- 基础全 True；`A_BOTHER` 恒 False（env2.py:262）。
- `strikeable[i]` = i 存活，且存在 j：`known[i,j] ∧ alive[j] ∧ ¬in_domain[j] ∧ ¬windup[j]`
  （env2.py:259-260）。控制动作 4/8/9/6/7 的基础合法性。
- `A_BSELF`(2)：`tech>1.0 ∨ res>10.0`（严格大于）。
- `A_OBSERVE`(7)：strikeable ∧ `tech>5.0`。
- `A_BDOMAIN`(5)：`enable_black_domain ∧ tech>5.0 ∧ alive`。
- `A_STRIKE/WEAK/STRONG`(4/8/9)：strikeable ∧ `tech>7.0`。
- 域内/风窗行（`in_domain ∨ windup`）：动作 2,3,4,6,7,8,9 全非法 → 只剩 {SILENT, DEVELOP,
  BLACK_DOMAIN}（BDOMAIN 在掩码层仍合法，但 resolve 的 `entering` 排除已域内者 → 重选为 no-op）。
- 死亡行：全非法除 SILENT（env2.py:284-285）。

### resolve 内的防御性净化（eff，env2.py:373-393）

无论掩码如何，resolve 都会把非法动作降为 SILENT：无任何已知存活目标却选了 4/6/7/8/9（374-378）；
域内/风窗行选了 {DEVELOP, BDOMAIN, SILENT} 之外的动作（380-382）；各科技门槛复查（384-391）；
黑域关闭时 BDOMAIN（392-393）。**TS 移植建议照抄**（人类玩家绕过掩码提交时同样兜底）。

## 5. 两阶段 tick 协议（游戏驱动接口；无 step()）

每刻调用序（驱动方=游戏；实验中 train2.py:136-151 / stage_b.py:36-62 为事实协议）：

```text
obs, valid = env.reset()                         # (n,38) float32 / (n,10) bool
每刻：
1. actions = <所有存活文明的决策>(obs, valid)    # (n,) int；必须尊重 valid
2. tmask = env.select_targets(actions)           # (n,n) bool：仅 INVADE 与 STRIKE 行需要显式目标；
                                                 #   候选 = known ∧ alive(目标) ∧ ¬in_domain(目标)
                                                 #   （注意不查 windup，见 Q4/风窗期）
3. targets = <选择>(tmask)                       # (n,) int，-1=无
4. invaded = env.begin_tick(actions, targets)    # 锁定动作+目标；**入侵通知立即生效**：
                                                 #   受害者 known[ victim, invader ]=True（env2.py:354-359）
                                                 #   返回被入侵者列表
5. 受害者重选（re_actions 覆盖其动作）           # ★人类玩家关键交互点：
                                                 #   - 受害者此刻已知道入侵者，用 env._obs()/_valid() 重新决策
                                                 #   - 重选 INVADE = 反咬互毁（不需要合法目标，Q9）
                                                 #   - 重选 BLACK_DOMAIN = 当场取消入侵（但入侵者已暴露，Q10）
6. obs, valid, rewards, alive, done, info, dead_now = env.resolve(re_actions)
```

- `resolve` 返回 7 元组（env2.py:628）：下一刻 obs/valid、rewards (n,)、alive (n,) 副本、done、
  info 事件字典（§10）、dead_now (n,) bool。
- 人类玩家接入点：正常动作 + 显式目标选择（打击/入侵）；被入侵时的重选 UI（限时决策）。
- DQN 对手同样走此协议（批处理 act + 重选，见 ai-opponents.md）。

## 6. resolve 结算顺序（env2.py:362-628，一步不可颠倒）

| 步 | 内容 | 行号 | 要点 |
|---|---|---|---|
| 预 | re-actions 覆盖被入侵者动作 | 364-367 | |
| 预 | eff 净化 | 373-393 | §4 |
| 0 | 域激活：`in_domain ∨= windup`；windup 清零；新声明者 `rewards−=0.5`、windup 置位（下刻生效） | 395-400 | `entering` = eff==BDOMAIN ∧ alive ∧ ¬in_domain ∧ ¬windup（重选为 no-op） |
| 0.5 | 观测反曝光：上刻 pending_counter 中每个存活非域观测者 i，被一个从"存活∧非域∧≠i"中**均匀随机**选出的 k 得知（`known[k,i]=True`+first_detect_tick；若 k 已知 i 则无事件但**仍消耗 RNG**） | 402-418 | "看见即被看见" |
| 1 | 延迟广播结算：`known[所有存活, j]=True`、`public[j]=True`；**发送者已死也生效**（垂死广播）；不写 first_detect_tick；含 Q2 自知 | 420-425 | |
| 2 | 被动探测（§7 公式）；只置 `known`+first_detect_tick，不泄露 tech/res | 427-442 | **先于打击**：同刻被发现即可同刻被打 |
| 3 | 本刻 BSELF 入队 pending_reveal（下刻结算） | 444-450 | |
| 4 | 打击：按槽位升序处理打击行。目标选择：WEAK=已知最弱（argmin tech）、STRONG=已知最强（argmax tech）、STRIKE=显式目标（合法时）否则最近已知；候选=known∧alive∧¬in_domain∧¬windup（对角 ∞，**无距离限制**）。护盾判定在抽签前（Q12）；击杀记录后**统一置 alive=False + 死因 strike**（09-22 修复本体，env2.py:498-506）。同刻多打击者：先到先得（`j not in kills`），后来者仍抽签、仍发 "killed" 事件但不重复击杀 | 452-506 | 打击受害者**不被掠夺**，尸体全额入池 |
| 5 | 入侵：双方仍存活 ∧ 受害者非域∧非风窗（env2.py:513-514）→ **必杀**（无抽签，护盾无效）；受害者 re-action==INVADE → 互毁（双方死）；掠夺=半数资源给**仍存活**的击杀者（互毁则无掠夺），尸余下一半留体内待 8b | 508-535 | |
| — | 死亡记账：dead_now = strike∪invade∪mutual；死因赋值顺序 strike→invade→**mutual 覆盖** | 537-547 | |
| 6 | 观测：目标=最近已知（argmin known_alive_d）；`observed[i,j]=True`；i 入队 pending_counter（下刻曝光） | 549-555 | 无距离限制 |
| 7 | 发展+爆炸：DEVELOP 者先增长（§7）；peak_tech 更新；随后**全体存活者**掷爆炸（无论动作） | 557-571 | p_kill 用的是**本刻初**科技；爆炸独立于动作 |
| 8 | 流失→饿死：p=0.02 损 U[0.5,2]（clip 到不低于 0）入池；res≤0 → 死因 starve（**域内照常饿死**——反蹲机制） | 573-585 | |
| 8b | 守恒结算：本刻所有死者剩余 res → 自由池，res=0 | 587-592 | |
| 9 | 奖励：dead_now 各 −10；DEVELOP 且**仍存活**者 +Softsign（用**增长后**科技） | 594-603 | |
| 10 | 内生出生（§3） | 605-606 | |
| — | `last_action=eff`；`t+=1`；重算 obs/valid；done 判定；组装 info | 608-628 | |

同刻因果要点：探测(2)→打击(4) 同刻可连锁；黑域声明(0) 使声明者当刻即免打击/免入侵（风窗 Q4）；
打击(4)先于入侵(5)——被打击致死者使入侵失效(511)；饿死(8)在战斗后；奖励(9)用增长后科技。

## 7. 公式明细（逐条，含行号）

- **环面距离** `_pair_dist`（159-162）：逐轴 `δ=|pi−pj|`，`δ=min(δ, world−δ)`，再欧氏范数。
- **探测**（428-436）：`p_det[i,j] = min(0.03·√tech_i · (0.25 若目标本刻 eff==SILENT 否则 1), 0.35)`；
  概率由**探测者**科技驱动；行（探测者）in_domain∨windup → 0；列（目标）in_domain → 0（**风窗目标仍可被探测**）；
  资格掩码 = 双方存活 ∧ ¬known[i,j] ∧ 距离≤30 ∧ i≠j；每刻整张 `uniform(n,n)` 一次比较。
- **打击**（491）：`p_kill = clip(0.55 + 0.12·(tech_i − tech_j), 0.15, 0.95)`；等科技 0.55；+10 封顶 0.95；
  −10 触底 0.15。攻击零成本。
- **护盾**（484-490）：`tech_j ≥ 2.0·tech_i`（边界恰为 2.0）→ 挡下；`take = 0.5·max(res_j,0)`；
  `res_j −= take`；`free_pool += take`；不消耗 RNG（Q12）；不挡入侵/饿死。
- **掠夺**（529-535）：`take = 0.5·max(res_victim,0)` → 存活的击杀者；受害者留一半（死入池）。
- **发展**（561-565）：`Δtech = 0.05·(1 − tech/10⁶)`，域内 ×0.2。≈ +0.05/刻 线性无上界。
- **爆炸**（567-571）：p=0.01/刻（域内 ×0.1）；命中 `tech ×= uniform(1.6,2.2)`，复合无上限；
  `uniform(n)` 每刻**无条件**抽取，倍率向量仅 boom.any() 时抽。
- **流失/饿死**（574-585）：p=0.02/刻；损 `uniform(0.5,2)`（clip 至 res≥0）入池；res≤0 → starve。
  期望流失 0.025/刻 → 初始资源 ~12.5 理论可撑 500 刻（>局长）；饿死主因是护盾放血+出生扣款+尸体回流的
  池经济挤压，而非直线衰减。
- **守恒结算**（587-592）：`res_total − Σres − free_pool ≡ 0`（残差每刻报入 info，Q5）。
- **奖励**（599-603）：见 §8。
- **出生科技校准**（239-247）：见 §3（注意 numpy 线性插值百分位的等价实现）。

## 8. 奖励函数（v2.3 = v2.2s 尺度）

| 信号 | 公式 | 值 | 备注 |
|---|---|---|---|
| DEVELOP | `+ 0.01 · tech/(1+0.2·|tech|)`（增长后科技，仍存活者） | 渐近 +0.05/刻 | 早期陡峭后期趋平的塑形在奖励不在增长 |
| 死亡（任意死因） | `− death_penalty` | −10 一次性 | 回报级支配：发展流现值 ≈ 0.05/(1−0.995)=10 |
| 黑域入场 | `− 0.5` | 声明刻瞬时 | 域内再声明无重复惩罚 |
| 其余（存活/静默/打击/入侵/掠夺/广播/观测/被发现） | 0 | — | 生存压力经资源通道传导，不经奖励 |

游戏 UI 不必向玩家展示奖励（它是训练信号）；若做"分数"可另设计，但**环境内部计算必须保留**本表
（对手 DQN 的输入不受影响，奖励只影响训练——游戏不训练即可不实现，实现则须等价）。

## 9. 观测向量 38 维精确布局（`_obs`，env2.py:289-331；float32）

每文明 i：`[ 自身标量 7 | 上刻动作 one-hot 10 | 近邻块 3×7 ]`，死亡行**整行清零**（env2.py:330）。

**自身标量（298-306）**：
1. `log1p(max(tech,0)) / log1p(50)`
2. `max(res,0) / 20`（掠夺后可 >1）
3. `(known[i,:] ∧ alive).计数 / (n−1)`（**含 Q2 自知**；只计存活者）
4. `存活数 / n`（全行同一标量）
5. `t / 250`
6. `in_domain`（0/1）
7. `domain_windup`（0/1）

**one-hot（293-294）**：`last_action`（上刻生效动作；初始 0=SILENT）。

**近邻块（308-328）**：候选矩阵 `big` = 距离（≤30）否则 ∞；对角 ∞；非 `known∧alive∧¬in_domain(目标)`
为 ∞（310）。`order = argsort(big)[:, :3]`（不足 3 个时由 ∞ 槽补位）。每槽 7 维：
1. 环面 Δx/50 × dmask；2. Δy/50 × dmask（wrap：`delta −= world·round(delta/world)`，315）
3. d/50（dmask 否则 0）
4. `log1p(tech)/log1p(50)`，条件 `known_pair ∧ observed[i,·]`，否则 **−1.0**
5. `res/20`，同条件，否则 **−1/20 = −0.05**（注意 −1 直接除以 20，与第 4 维的裸 −1 不同）
6. `public[目标] × known_pair`
7. `in_domain[目标] × known_pair` ——**恒 0**（Q3，照抄）

其中 `known_pair = known ∧ alive(目标) ∧ ¬in_domain(目标)`（313）；`dmask = isfinite(big)`（316）。
∞ 补位槽的全部特征退化为 `[0,0,0,−1,−0.05,0,0]`（与补位者是谁无关 → 内容确定）。
**不含**自身坐标、自身 public、身份信息；已知但 >30 距离者只计入第 3 维计数、永不进近邻块。

## 10. info 事件流字段字典（env2.py:616-627；游戏渲染数据源）

| 字段 | 类型 | 语义 |
|---|---|---|
| `detections` | [(探测者 i, 被探测者 j)] | 本刻被动探测 + 反曝光新知 |
| `strikes` | [(i, j, killed:bool)] | 未被护盾挡下的打击尝试 |
| `invasions` | [(入侵者, 受害者, mutual:bool)] | 互毁时两条（双方各一） |
| `strike_events` | [(i, j, "killed"\|"survived"\|"blocked", tech_i, tech_j, shield_take)] | 全量打击事件（含被挡与双方科技） |
| `strikes_blocked` | [(i, j, take)] | 被护盾挡下的打击（take=目标耗散额） |
| `loot_to` | (n,) float | 各文明本刻掠夺所得 |
| `died_this_tick` | [(slot, cause)] | cause ∈ strike/invade/mutual/starve |
| `free_pool` | float | 结算后池值 |
| `res_conservation_residual` | float | 守恒残差（应 ≈0，Q5） |
| `n_births` / `n_alive` / `in_domain` | int | 计数（in_domain=域内数） |
| `counter_detections` | int | 反曝光实际新增数 |

## 11. 终止条件（env2.py:611-615）

`done = (t ≥ 250) ∨ ( 全灭 ∧ free_pool < pending_spawns[0] )` ——定长时间是主时钟；唯一提前结束是
**物理热寂**（无人存活且池付不起下一个预滚出生）。没有"最后幸存者获胜"判定：独存活者也要走满
250 刻；玩家目标=活到终局。

## 12. RNG 一致性策略

Python 端单一 `np.random.default_rng`（**PCG64**），构造时定种子；`reset()` 不传种子则**延续**流
（跨回合连续）。消耗点与顺序（逐位复现必须完整照抄，任何重构都会破坏）：

- **reset**：`uniform(0,100,(n,2))` 站位 → （Q1 触发时）每次修复 `uniform(0,100,2)` →
  `uniform(0.5,10,n0)` 初始科技 → `uniform(5,20,n0)` 初始资源 → `uniform(5,20)` 首个预滚。
- **resolve**：反曝光 `choice(候选)`（每个待曝光观测者一次）→ `uniform(n,n)` 探测 →
  每个未挡打击一次 `uniform()`（升序）→ `uniform(n)` 爆炸（无条件抽）+ boom 时 `uniform(1.6,2.2,k)` →
  `uniform(n)` 流失（无条件抽）+ deplete 时 `uniform(0.5,2,k)` → 出生时 `uniform(5,20)`（预滚）
  再 `uniform(lo,hi)`（科技）。`begin_tick`/`_obs`/`_valid` 不消耗 RNG。

**推荐双口径验收**（游戏不必逐位复刻 PCG64；本机生成金标准时同样须 `PYTHONUTF8=1`，见 CLAUDE.md）：

1. **确定性脚本用例**：固定种子在 Python 端录制"动作序列 → 事件流/状态轨迹"金标准 JSON；
   TS 对这些用例逐刻比对事件流与关键状态（存活/死因/池/资源/科技）。RNG 相关的分支
   （探测命中/爆炸/流失）在录制中固化结果。
2. **统计等价**：多世界（≥100 局）对比聚合量（存活率分布、死因构成、出生数、池轨迹均值±方差），
   容差写入测试。
3. 游戏运行时用自己的 RNG（如 PCG64/xoshiro128** 的 TS 实现）+ 固定种子即可复现单局；
   若追求与 Python 完全同局，才需要移植 PCG64 + 上述完整消耗序。

## 13. test_strike_fix 行为锁定与移植验收

`experiment/experiment/tests/test_strike_fix.py`（63 行）：`_force_strike(seed, tech_i, tech_j)` 手工
构造已知对 + 显式打击目标，跑 `begin_tick`+`resolve`；对 **10 个种子** 各做三断言（"10/10 通过"
即 10 种子全过）：

1. **KILL**（种子 100+s，tech 20 vs 1 → p_kill 封顶 0.95）：受害者 `alive=False` ∧
   `death_cause="strike"` ∧ strike_events 含 `"killed"` ——**锁定 09-22 修复本体**。
2. **CONSERVATION**：击杀后 `|res_conservation_residual| ≤ 1e-6` ——锁定击杀+尸体回流的守恒账本。
3. **BLOCK**（种子 200+s，tech 10 vs 25，比值 2.5≥2 且双方过打击门槛 7）：受害者存活 ∧
   事件 `"blocked"` ——锁定护盾 2.0 边界与"目标付账"路径。

（报告另提及"低于打击门槛的动作降级为 SILENT"为修复行为，但该文件未断言；TS 侧建议补上。）

**TS 验收测试建议**（游戏仓库建立时实现）：复刻上述 20 个用例 + 守恒全程断言 + 36 槽满员/出生
排空用例 + 饿死/互毁/垂死广播/同刻黑域取消入侵的脚本化用例 + §12 双口径金标准。
