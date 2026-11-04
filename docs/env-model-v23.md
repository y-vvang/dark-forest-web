# DarkForestGrid v2.5 环境移植规格（Python → TypeScript 权威对照）

> **用途**：网页游戏对实验环境的忠实移植规格。一切以代码为准：
> `experiment/experiment/env2_v25.py`（748 行，类 `DarkForestEnv2`）+ `experiment/experiment/config_v25.yaml`。
> 本文行号优先指 env2_v25.py（v2.4 结构未变处沿引 env2_v24.py 行号）。v2.4 相对 v2.5 的
> diff 仅 104 插入/10 删除——resolve/_valid/select_targets/_pair_dist/打击/护盾/探测/经济/
> 黑域/奖励**逐字节相同**；v2.5 变更清单见 §0.2。v2.3-fix 原版见 git 历史。
> 配套：`docs/ai-opponents.md`（DQN 推理与预制策略）。CLAUDE.md 为总入口。

## 0. 移植原则与已知陷阱（quirk 清单）

**原则**：文档（含 experiment/README.md 与 experiment_report.md 的机制描述）与代码冲突时，
**一律以 env2_v24.py 为准**。历史背景：v2.0–v2.3 存在"打击击杀不清 alive"的结算 bug，
2026-09-22 修复（:510-518）后即 v2.3-fix；v2.4 在其上做六项变更（见 §0.1）。

移植时必须**照抄**的已知 quirk（影响 obs 逐位一致与行为等价）：

| # | quirk | 位置 | 说明 |
|---|---|---|---|
| Q1 | 出生站位拒绝采样读取**上一局**的 `self.pos` | :195-202 | 首次 reset 时 `hasattr(self,"pos")` 为 False → 全 ∞ → **完全不生效**；后续 reset 按旧位置判定。TS 以 `_hasPos` 哨兵复刻 |
| Q2 | 广播者/揭露目标"自知" | :435-437 | `known[alive, j]=True` 使 j 的自身行含 j（广播者自知；**揭露目标也"自知"被公开**——与被揭露者不知谁揭露形成机制性欺骗面，见 Q14） |
| Q3 | 近邻块 in_domain 特征恒 0 | :329,343 | `known_pair` 排除域内目标，而 in_domain 特征 = `in_domain[目标]×known_pair` → 恒 0 |
| Q4 | 风窗期不可被打击/入侵 | :481-483,525-526 | 文档称"风窗期可被打击"是错的：`domain_windup` 目标被打击/入侵掩码排除；风窗期只剩"仍可被探测"（:444 只清 in_domain 列） |
| Q5 | 守恒"断言"实为 info 字段 | :649 | `res_conservation_residual` 是每刻报告的残差，外部按 \|·\|≤1e-6 检验；无 Python assert |
| Q6 | `develop_reward` 是死参数 | :101,138 vs 611-629 | config 的 0.05 从未被 resolve 使用；奖励只走 `softsign_reward_scale` |
| Q7 | `exists` property 无人引用 | :244-247 | `alive & (t≥spawn_tick)`；全部逻辑只看 `alive`。TS 保留 parity 但 resolve 不引用 |
| Q8 | `_obs` 中 `crowd` 计算后未使用 | :308 | v1.x 领土拥挤遗留，无效果，不移植 |
| Q9 | 反咬不需要合法目标 | :527-535 | 被入侵者重选动作=INVADE 即触发互毁，环境不看目标是谁 |
| Q10 | 反击入侵仍会暴露 | :369-375 | 入侵通知在 begin_tick 即发生；受害者即便当场声明黑域取消入侵，入侵者已被知晓（白暴露） |
| Q11 | ~~槽位一次性~~ **v2.5 三级出生偏好取代** | env2_v25.py:325-344 | 出生槽偏好：最靠前未生槽 → 最靠前**已死槽复用**（同刻死者即可复用）→ `_grow` 扩容。复用清社会态（known/observed 行列、public、under_attack、in_domain、windup、first_detect_tick、last_action、death_cause；peak_tech 由公共路径重置）；**last_invader 不清**、**pending_reveal/counter 不滤**（见 Q17/Q18） |
| Q15 | ~~在线槽复用（明示偏离）~~ **已消解** | — | 用户 2026-10-14"取消 36 上限"的偏离条款随实验 v2.5 采纳死槽复用为缺省行为而关闭（2026-11-01）；原游戏的 deadNow 同刻跳过与 pending 过滤是对 v2.5 的偏离，已移除 |
| Q12 | 阻挡的打击不消耗 RNG | :495-501 | 护盾判定在 p_kill 抽签**之前** continue |
| Q13 | **掩码行特征 = argsort 平局序伪影** | :327,329-334 | 近邻块候选不足 3 时，`order = np.argsort(big)` 的 ∞ 平局序决定第 k 位是谁；该位的 tech/res/public 特征取**该文明**的 `known_pair ∧ observed` 旗标（距离无关）——Δx/Δy/d 仍被 dmask 清零，但情报旗标会"泄漏"远处公开者。平局序非稳定非索引序 → **须逐位移植 numpy 1.26.4 argsort introsort**（`src/lib/engine/numpy-sort.ts`，2005 numpy 生成矢量锁定）。v2.3 的"补位槽内容确定"断言为侥幸，v2.4 揭露机制使其爆出 |
| Q14 | **揭露归因歧义**（v2.4 新；v2.5 部分改观） | :457-472,435-437 | BOTHER 揭露目标 j：①被揭露者**自知已公开**（v2.5 self_public 持续可见——但仍**不知是谁**揭露的，归因歧义保留）；②他人揭露的第三方 j 在所有观测者视角与"j 自曝"完全同形（known[alive,j]+public[j]，BSELF 同路径）——借刀杀人不可归因，机制即欺骗 |
| Q17 | **born-public 穿越**（v2.5 新） | :329-344 | 死槽复用**不滤 pending_reveal**——死者被揭露的延迟公开落在复生者头上（出生即 public）。忠实照抄（游戏侧旧过滤已移除） |
| Q18 | **last_invader 复用存活**（v2.5 新） | :332-340 | 复用清除清单**不含 last_invader**——复生 df 仍可反咬前任住客的入侵者。忠实照抄 |
| Q19 | **同刻复用清死因**（v2.5 新） | :340 vs :739 | 复用在 died_this_tick 装配**之前**清 death_cause → 事件流死因 "" 抵达上层（游戏层翻译为 cause.unknown）。Q16 的增长路径外另一处"上游怪味"——行为以代码为准 |
| Q16 | **_grow 的 last_action 覆盖 bug**（v2.5 新，明示偏离） | env2_v25.py:728 | python resolve 尾部 `self.last_action = eff` 在 _grow 扩容后用旧长数组覆盖补齐数组（**增长刻自身的 resolve 尾部 _obs() 即崩**——本机复现 IndexError，根本活不到 reset）；增长路径实验从未触发（probe: max_alive 9-12），游戏配置面板可调大预算故可达——**TS 照增长语义修复**（eff 拷入新长度数组、新槽保持 A_SILENT；修复后 reset 亦自洽，游戏每局新 env 路径不可达）。**配套消费端守卫**：resolve 返回的 rewards/loot_to/rewardDetail 按旧 n 分配（python 同构）——会话/视图/驱动的增长槽读数须长度守卫（评审 I-1，match/view/rewards/driver 四处） |

另注意：世界是 **[0,100)² 连续坐标**（"Grid"为历史名称，并非离散网格）；恒星位置永不改变；
`known` 一旦置位永不遗忘。

### 0.1 v2.4 相对 v2.3-fix 的六项变更（代码写死，env2_v24.py:84-91）

1. **BROADCAST_SELF → BROADCAST_ALL**（改名，索引 2 不变，语义同：全体广播自己坐标）。
2. **BROADCAST_OTHER 恢复**（索引 3）：揭露 known 目标坐标给全宇宙（`pending_reveal("other", j)` → 下刻
   `known[all alive, j]=True; public[j]=True`），**发送者不暴露**；需显式目标（-1 = 无揭露）；
   付 `attack_reward`（d 臂）。
3. **删 STRIKE_WEAK/STRONG**（原 8/9——按未观测科技排序选目标=观测前作弊）；N_ACTIONS 10→8、OBS_DIM 38→36。
4. **OBSERVE 显式选目标**（STRIKE 同协议：显式否则最近已知兜底）。
5. **禁科技继承**：出生科技恒 `tech_spawn_lo`（config 钉 lo=hi=1.0——同起跑线）；v2.3 的 P25–P75
   percentile 抽取删除（**每次内生出生少消耗 1 个 RNG 值**）。
6. **奖励臂参数**：`res_reward_scale`（DEVELOP 刻 +scale·res，>0 才加）与 `attack_reward`
   （打击击杀认领/入侵缴获/揭露各 +attack，默认 0=关；四臂 override 见 §8.1）。

### 0.2 v2.5 相对 v2.4 的变更（env2_v25.py；除此外逐字节相同）

1. **OBS_DIM 36→38**：自身标量 7→9——`[7] under_attack`、`[8] self_public` 追加在
   domain_windup 后（one-hot 与近邻块整体 +2 移位）。
2. **归一化固定分母**：knownAlive 与 aliveCount 均除以 `n_norm`（ctor 第 2 位置参数，
   缺省 36.0，yaml 无此键）并 `clip [0,2]`（v2.4 为 /(n−1) 与 /n）。
3. **under_attack 滑窗**：`begin_tick` 先清全部、再随入侵通知置位（重选 obs 与下一刻
   obs 可见，再下一 beginTick 清除；STRIKE 不设）。
4. **新 env 态 `last_invader[j]`**（缺省 −1，不入 obs；v2b 启发式用；复用不清——Q18）。
5. **出生三级偏好**（取代 v2.4 槽耗尽即停）：unborn 槽 → 死槽复用（同刻死者即可，
   社会态全清；Q11/Q17/Q19）→ `_grow` 扩容（n 翻倍、新槽白纸、位置单抽；Q16）。
   **RNG 差异**：复用/增长分支消耗预滚重抽（v2.4 此处早退零消耗）。
6. **每次出生 `peak_tech[slot] = tech[slot]`**（逐代峰值重置，:356）。
7. **self_public**：被揭露者（含自曝者）每刻自知已公开（持久；黑域不洗）。
8. 终局不变（t_max 或热寂——复用使热寂更罕见但可达）。

## 1. 参数表（config_v24.yaml 全量 + env2_v24.py 默认值）

### env 参数（config_v24.yaml:25-62；构造函数 :97-170）

| 参数 | v2.4 值 | 默认 | 语义 |
|---|---|---|---|
| `n_agents` | 36 | 12 | 槽位数（v2.5：初始槽数——死槽可复用、满员可 _grow，见 Q11/Q16） |
| `n_norm` | **36.0**（ctor 缺省，yaml 无此键） | 36.0 | v2.5 obs 计数归一化固定分母（clip [0,2]） |
| `world` | 100.0 | 100.0 | 世界边长；坐标连续，环面 |
| `detect_radius` | 30.0 | 30.0 | 探测/近邻块半径（硬截断，无衰减） |
| `t_max` | 250 | 250 | 定长刻数 |
| `p_detect_base` | 0.03 | 0.03 | 探测基础概率系数 |
| `stealth_mult` | 0.25 | 0.25 | 目标 SILENT 时截面缩减 |
| `p_detect_max` | 0.35 | 0.35 | 探测概率上限 |
| `p_explosion` | 0.01 | 0.01 | 每刻科技爆炸概率（域内 ×`bd_explosion_mult`） |
| `develop_rate` | 0.05 | 0.05 | 线性增长系数 |
| `tech_cap` | 1e6 | 1e6 | 名义上界（实际线性） |
| `tech_spawn_lo/hi` | **1.0 / 1.0** | 同 | 初始科技 U[lo,hi]（lo=hi 即恒 1.0）；**出生科技恒取 lo**（无继承） |
| `kill_base` / `kill_tech_slope` | 0.55 / 0.12 | 同 | p_kill 基数/斜率 |
| `res_min/res_max` | 5.0 / 20.0 | 同 | 出生资源 U 区间；obs res 归一化分母=res_max |
| `res_total_budget` | 150.0 | 150.0 | 守恒总量 |
| `shield_cost_frac` | 0.5 | 0.5 | 护盾挡击时目标耗散比例 |
| `softsign_a` / `softsign_reward_scale` | 0.2 / 0.01 | 同 | 科技奖励形状/量级 |
| **`res_reward_scale`** | **0.0** | 0.0 | **v2.4 新**：DEVELOP 刻资源津贴系数（>0 才加） |
| **`attack_reward`** | **0.0** | 0.0 | **v2.4 新**：击杀认领/入侵缴获/揭露赏金 |
| `p_deplete` | 0.02 | 0.02 | 每刻自然流失概率 |
| `deplete_lo/hi` | 0.5 / 2.0 | 同 | 流失量 U 区间 |
| `gate_broadcast_tech/res` | 1.0 / 10.0 | 同 | 广播与揭露共用门槛（严格 >） |
| `gate_observe_tech` | 5.0 | 5.0 | OBSERVE 门槛 |
| `gate_domain_tech` | 5.0 | 5.0 | BLACK_DOMAIN 门槛 |
| `gate_strike_tech` | 7.0 | 7.0 | 打击门槛 |
| `develop_reward` | 0.05 | 0.05 | **死参数**（Q6） |
| `death_penalty` | 10.0 | 10.0 | 死亡惩罚 |
| `bd_entry_penalty` | 0.5 | 0.5 | 黑域入场瞬时惩罚 |
| `bd_growth_mult` / `bd_explosion_mult` | 0.2 / 0.1 | 同 | 域内倍率 |
| `enable_black_domain` | true | True | 黑域开关 |
| `spawn_schedule` | [[0,4]] | [(0,12)] | **只用第一项**：初始 4 文明；后续出生纯池驱动 |

### 模型/训练/评测参数（config_v25.yaml:64-86；不属于环境，仅供复现）

`model`: obs_dim **38**、n_actions **8**、hidden [64,64]；`train`: episodes 600、γ 0.995、lr 6e-4、
batch 128、replay 150k、target_sync 2000、ε 1.0→0.05（前 50% 回合退火）、seeds [42]；`eval`:
episodes 150、ε 0.05。（train2_v25 同 v2.4 惟 import data2_v25；model.py 的 ReplayBuffer
有效掩码宽度参数化 `n_valid`——仅训练期，游戏只做推理。）

### 代码内派生常数

`NEAR_K=3`（:92）；`OBS_DIM = 9+N_ACTIONS+NEAR_K*7 = 38`（:108）；`LOG_REF = log1p(50)`（:313）；
近邻 Δ、d 归一化分母 50；res 归一化分母 res_max=20；初始站位最小距离 12.0（Q1）；未出生标记
`spawn_tick=10^9`。（v2.3 的"出生科技最小跨度 1.0"随无继承删除。）

## 2. 世界与状态字段（reset，:189-241）

| 字段 | 形状/类型 | 初值 | 语义 |
|---|---|---|---|
| `pos` | (n,2) float | uniform(0,100)（Q1 拒绝环实际仅二次 reset 生效） | 恒星位置，永不移动 |
| `tech` | (n,) float | 前 n0 个 ~U[lo,hi]=**1.0**，其余 0 | 科技，无上界 |
| `res` | (n,) float | 前 n0 个 ~U[5,20]，超 150 按比例缩放（:215-217）；其余 0 | 资源；掠夺后可>res_max |
| `alive` | (n,) bool | 前 n0 True | 存活；死后 False 至槽被复用（v2.5 三级出生） |
| `spawn_tick` | (n,) int | 前 n0 为 0，其余 10⁹ | 出生刻；出生时记 `t+1` |
| `spawn_tech/spawn_res` | (n,) | 出生值快照 | 分析分层用（v2.4 全 1.0 → stage_b_v24 改按 **peak_tech** 分层） |
| `known` | (n,n) bool | 全 False | `known[i,j]`=i 知道 j 存在；**永不遗忘** |
| `observed` | (n,n) bool | 全 False | 精确 tech/res 情报（OBSERVE 所得） |
| `public` | (n,) bool | 全 False | j 的坐标已对全体公开（自曝或被揭露）；v2.5 入 obs[8]（self_public 自知） |
| `under_attack` | (n,) bool | 全 False | v2.5：被入侵滑窗旗标（beginTick 先清后设；重选 obs 与下一刻 obs 可见） |
| `last_invader` | (n,) int | 全 −1 | v2.5：各槽最近入侵者（不入 obs；复用不清——Q18） |
| `in_domain` / `domain_windup` | (n,) bool | 全 False | 黑域生效 / 已声明下刻生效 |
| `last_action` | (n,) int | 全 A_SILENT(0) | 上刻**生效后**动作（eff）；obs one-hot 来源 |
| `first_detect_tick` | (n,n) int | 全 −1 | i 首次得知 j 的刻；广播/揭露**不写**（:435-437） |
| `death_cause` | (n,) str | "" | `strike/invade/mutual/starve` |
| `peak_tech` | (n,) float | 出生值 | 存活期最高科技（分析用） |
| `free_pool` | float | 150 − Σres₀ | 自由资源池 |
| `pending_spawns` | list[float] | [uniform(5,20)] | **恒恰好一个**预滚出生资源 |
| `birth_log` | list | [] | (tick, slot, spawn_res) |
| `pending_reveal` | list | [] | 延迟公开队列 (kind, j)：kind ∈ "self"（BALL）/"other"（BOTHER 揭露）——结算端同式应用 |
| `pending_counter` | list | [] | 上刻 OBSERVE 者的待曝光队列 |
| `t` | int | 0 | 当前刻 |

初始 n0 = spawn_schedule[0][1] = 4。`pending_reveal` 应用（:435-438）对两种 kind 同式：
`known[所有存活, j]=True; public[j]=True`——"信号已发出，不在乎发送者/目标存亡"。

## 3. 出生机制（_activate_pending_spawns，env2_v25.py:309-359）

每刻结算**末尾**调用（resolve 步骤 10），每刻至多 1 个：

1. 队列空 / `free_pool < pending_spawns[0]` → 不出生。
2. **槽偏好三级（v2.5）**：最靠前未生槽（`spawn_tick>10⁸`）→ 最靠前**已死槽**（复用：
   社会态全清见 Q11/Q17/Q19；**同刻死者即可复用**）→ 全槽存活 ⇒ `_grow(n+1)`（n 翻倍、
   新槽白纸、新槽位置一次抽取 `uniform(0,world,m*2)`；Q16）——守恒是唯一刹车。
3. `spawn_res = pending_spawns.pop(0)`；**立即**预滚下一个 `uniform(5,20)` 入队（队列永不清空；
   v2.4 槽耗尽早退不消耗 RNG，v2.5 复用/增长分支照常消耗）。
4. **无科技继承（v2.4 起）**：`tech[slot] = tech_spawn_lo`（恒 1.0）——不抽 RNG、不看存活分布；
   分层是挣来的（stage_b_v25 按 peak_tech 分层），不是出生的。
5. `res[slot]=spawn_res`；`free_pool −= spawn_res`；`spawn_tech/spawn_res` 快照；
   **`peak_tech[slot]=tech[slot]`（v2.5 逐代重置）**；`spawn_tick[slot]=t+1`（下一刻起可行动）；
   `alive[slot]=True`；birth_log 记 `(t+1, slot, spawn_res)`。

初始 4 文明在 t=0 直接 alive（科技恒 1.0、资源 U[5,20] 按预算缩放）。

## 4. 动作空间与合法性掩码

### 动作枚举（:85-90，索引固定）

```
0 SILENT   1 DEVELOP   2 BROADCAST_ALL   3 BROADCAST_OTHER(揭露)
4 STRIKE   5 BLACK_DOMAIN   6 INVADE   7 OBSERVE
```

### `_valid()`（:278-298）逐条规则（TS 必须等价）

- 基础全 True。
- `strikeable[i]` = i 存活，且存在 j：`known[i,j] ∧ alive[j] ∧ ¬in_domain[j] ∧ ¬windup[j]`
  （:280-281）。**v2.4：A_BOTHER(3) 的基础合法性 = strikeable**（揭露需已知存活非域目标）。
- `A_BALL`(2) 与 `A_BOTHER`(3)：strikeable(仅 BOTHER) ∧ `tech>1.0 ∨ res>10.0`（广播门共用）。
- `A_OBSERVE`(7)：strikeable ∧ `tech>5.0`。
- `A_BDOMAIN`(5)：`enable_black_domain ∧ tech>5.0 ∧ alive`。
- `A_STRIKE`(4)：strikeable ∧ `tech>7.0`。
- 域内/风窗行：动作 2,3,4,6,7 全非法 → 只剩 {SILENT, DEVELOP, BLACK_DOMAIN}（BDOMAIN 重声明
  为 no-op：`entering` 排除已域内者）。
- 死亡行：全非法除 SILENT。

### resolve 内的防御性净化（eff，:389-406）

无任何已知存活目标却选了 4/6/3/7 → SILENT；域内/风窗行选 {DEVELOP, BDOMAIN, SILENT} 之外的
动作 → SILENT；各科技门槛复查（STRIKE>7、OBSERVE>5、BDOMAIN>5、BALL/BOTHER 广播门）；
黑域关闭时 BDOMAIN。**TS 照抄**（人类玩家绕过掩码提交时同样兜底）。

## 5. 两阶段 tick 协议（游戏驱动接口；无 step()）

每刻调用序（驱动方=游戏；实验中 train2_v24.py / stage_b_v24.py:36-79 为事实协议）：

```text
obs, valid = env.reset()                         # (n,36) float32 / (n,8) bool
每刻：
1. actions = <所有存活文明的决策>(obs, valid)    # (n,) int；必须尊重 valid
2. tmask = env.select_targets(actions)           # (n,n) bool：INVADE/STRIKE/BOTHER/OBSERVE 行
                                                 #   需要显式目标；候选 = known ∧ alive(目标) ∧ ¬in_domain(目标)
                                                 #   （不查 windup，见 Q4）
3. targets = <选择>(tmask)                       # (n,) int，-1=无
4. invaded = env.begin_tick(actions, targets)    # 锁定动作+目标；入侵通知立即生效：
                                                 #   受害者 known[victim, invader]=True（:369-375）
5. 受害者重选（re_actions 覆盖其动作）          # ★人类玩家关键交互点：
                                                 #   - 重选 INVADE = 反咬互毁（无需合法目标，Q9）
                                                 #   - 重选 BLACK_DOMAIN = 当场取消入侵（入侵者已暴露，Q10）
6. obs, valid, rewards, alive, done, info, dead_now = env.resolve(re_actions)
```

- `resolve` 返回 7 元组（:654）。注意 `_targets` 锁定跨动作复用：重选为另一目标型动作时沿用
  begin_tick 锁定的目标（如重选 BOTHER 揭露入侵者）。
- 人类玩家接入点：正常动作 + 显式目标选择（打击/入侵/揭露/观测）；被入侵时的重选 UI。
- DQN 对手同样走此协议（批处理 act + 重选，见 ai-opponents.md）。

## 6. resolve 结算顺序（:378-654，一步不可颠倒）

| 步 | 内容 | 行号 | 要点 |
|---|---|---|---|
| 预 | re-actions 覆盖被入侵者动作；eff 净化（§4） | 380-406 | |
| 0 | 域激活：`in_domain ∨= windup`；windup 清零；新声明者 `rewards−=bd_entry`、windup 置位 | 408-413 | `entering` = eff==BDOMAIN ∧ alive ∧ ¬in_domain ∧ ¬windup |
| 0.5 | 观测反曝光：pending_counter 每个存活非域观测者，被"存活∧非域∧≠i"中均匀随机的 k 得知（若 k 已知 i 无事件但**仍消耗 RNG**） | 415-431 | "看见即被看见" |
| 1 | 延迟公开结算：`known[所有存活, j]=True`、`public[j]=True`；**发送者/目标已死也生效**；不写 first_detect_tick；Q2 自知 | 433-438 | BALL 与 BOTHER 揭露同式 |
| 2 | 被动探测（§7 公式）；只置 `known`+first_detect_tick | 440-455 | **先于打击**：同刻被发现即可同刻被打 |
| 3 | 广播入队：**先全部 BALL（升序）再全部 BOTHER（升序）**——两个独立循环，顺序照抄。BOTHER 校验目标 known∧alive∧¬in_domain（风窗可揭露），通过则入队 +`attack_reward` | 457-472 | 发送者不暴露（Q14） |
| 4 | 打击（单模式）：显式目标（合法时）否则最近已知；候选=known∧alive∧¬in_domain∧¬windup（对角 ∞，无距离限制）。护盾判定在抽签前（Q12）；击杀认领付 `attack_reward`；击杀统一置 alive=False + 死因 strike（09-22 修复本体，:510-518）。同刻多打击者先到先得（`j not in kills`），后来者仍抽签、仍发事件但不重复击杀/赏金 | 474-518 | 打击受害者**不被掠夺**，尸体全额入池 |
| 5 | 入侵：双方仍存活 ∧ 受害者非域∧非风窗 → **必杀**；反咬互毁；掠夺=半数给仍存活的击杀者（付 `attack_reward`），尸余下一半待 8b | 520-548 | 互毁双方 killer 同刻死 → 无缴获无赏金 |
| — | 死亡记账：dead_now = strike∪invade∪mutual；死因赋值 strike→invade→**mutual 覆盖** | 550-560 | |
| 6 | 观测：显式目标（合法时）否则最近已知（同 STRIKE 协议，:565-569）；`observed[i,j]=True`；i 入 pending_counter | 562-572 | 无距离限制 |
| 7 | 发展+爆炸：DEVELOP 者先增长（§7）；peak_tech 更新；随后**全体存活者**掷爆炸（无论动作） | 574-588 | p_kill 用**本刻初**科技 |
| 8 | 流失→饿死：p=0.02 损 U[0.5,2]（clip ≥0）入池；res≤0 → starve（**域内照常饿死**） | 590-602 | |
| 8b | 守恒结算：本刻死者剩余 res → 自由池，res=0 | 604-609 | |
| 9 | 奖励：dead_now 各 −death_penalty；DEVELOP 且仍存活者 +softsign（增长后科技）+ `res_reward_scale·res`（>0 才加） | 611-629 | §8 |
| 10 | 内生出生（§3） | 631-632 | |
| — | `last_action=eff`；`t+=1`；重算 obs/valid；done 判定；组装 info | 634-654 | |

同刻因果要点：探测(2)→打击(4) 同刻可连锁；黑域声明(0) 当刻即免打击/入侵；打击(4)先于入侵(5)
——被打击致死者使入侵失效；饿死(8)在战斗后；奖励(9)用增长后科技/流失后资源。

## 7. 公式明细（逐条）

- **环面距离** `_pair_dist`（:184-187）：逐轴 `δ=min(|pi−pj|, world−δ)`，再欧氏范数。
- **探测**（:441-455）：`p_det[i,j] = min(0.03·√tech_i · (0.25 若目标本刻 eff==SILENT 否则 1), 0.35)`；
  探测者科技驱动；行（探测者）in_domain∨windup → 0；列（目标）in_domain → 0（**风窗目标仍可被探测**）；
  资格 = 双方存活 ∧ ¬known ∧ 距离≤30 ∧ i≠j；每刻整张 `uniform(n,n)` 一次比较。
- **打击**（:502）：`p_kill = clip(0.55 + 0.12·(tech_i − tech_j), 0.15, 0.95)`；攻击零成本。
- **护盾**（:495-501）：`tech_j ≥ 2.0·tech_i` → 挡下；`take = shield_cost_frac·max(res_j,0)` 入池；
  不消耗 RNG（Q12）；不挡入侵/饿死。
- **掠夺**（:539-548）：`take = 0.5·max(res_victim,0)` → 仍存活的击杀者（+attack_reward）；
  受害者留一半待 8b。
- **发展**（:578-582）：`Δtech = 0.05·(1 − tech/10⁶)`，域内 ×0.2。
- **爆炸**（:584-588）：p=0.01/刻（域内 ×0.1）；命中 `tech ×= uniform(1.6,2.2)`；
  `uniform(n)` 每刻**无条件**抽取，倍率仅命中时抽。
- **流失/饿死**（:591-601）：p=0.02/刻；损 `uniform(0.5,2)`（clip ≥0）入池；res≤0 → starve。
- **守恒**（:604-609）：`res_total − Σres − free_pool ≡ 0`（残差报入 info，Q5）。
- **奖励**（:611-629）：见 §8。

## 8. 奖励函数（v2.4：v2.2s 尺度 + 奖励臂两参数）

| 信号 | 公式 | 值 | 备注 |
|---|---|---|---|
| DEVELOP | `+ softsign_reward_scale · tech/(1+0.2·|tech|)`（增长后科技，仍存活者） | 渐近 +0.05/刻 | |
| DEVELOP（资源津贴） | `+ res_reward_scale · res`（**仅 >0 时**；流失后资源） | 0.0125–0.05/刻（scale 0.0025） | v2.4 新，c/d 臂 |
| 打击击杀认领 | `+ attack_reward`（首个认领者；后被挡/迟到者无） | 0.5（d 臂） | v2.4 新 |
| 入侵缴获 | `+ attack_reward`（仍存活的击杀者；互毁无） | 0.5（d 臂） | v2.4 新 |
| 揭露成功 | `+ attack_reward`（入队即付；无目标不付；BALL 自曝不付） | 0.5（d 臂） | v2.4 新——"只奖聪明恶意" |
| 死亡（任意死因） | `− death_penalty` | −10 一次性 | 回报级支配 |
| 黑域入场 | `− bd_entry_penalty` | −0.5 声明刻瞬时 | 域内再声明无重复罚 |
| 其余（存活/静默/打击未杀/广播/观测/被发现） | 0 | — | |

### 8.1 四奖励臂（runs/v25_arms/<arm>/config.yaml env 节；游戏 V25_ARMS 同源——臂值与 v2.4 相同）

| 臂 | override | 设计意图 |
|---|---|---|
| `a_classic` | —（=本表默认） | v2.3-fix 原味基准 |
| `b_terminal` | softsign 0、bd_entry 0 | 唯一信号 = 死亡 −10 |
| `c_res` | +res_reward_scale 0.0025 | 资源纳入奖励（与科技项量级相当、≪死亡 10） |
| `d_malintent` | c + attack_reward 0.5 | 成功才奖（被挡不奖、自曝不奖）——培养"聪明恶意" |

游戏层的奖励展示（配置流 + 四臂对比）与 `TickResult.rewardDetail`（TS-only 诊断：逐刻
techTerm/resAtReward/attackCount/bdEnter 原料，在 rewards 计算处顺带记录，**不进 info、
不参与 parity**）见 docs/game-mechanics.md 与 `src/lib/solo/rewards.ts`。

## 9. 观测向量 38 维精确布局（`_obs`，env2_v25.py:389-434；float32）

每文明 i：`[ 自身标量 9 | 上刻动作 one-hot 8 | 近邻块 3×7 ]`，死亡行**整行清零**（:433）。

**自身标量（:398-409）**：
1. `log1p(max(tech,0)) / log1p(50)`
2. `max(res,0) / res_max`（掠夺后可 >1）
3. `clip((known[i,:] ∧ alive).计数 / n_norm, 0, 2)`（**含 Q2 自知**；只计存活者；v2.5 固定分母）
4. `clip(存活数 / n_norm, 0, 2)`
5. `t / t_max`
6. `in_domain`；7. `domain_windup`
8. **`under_attack`**（v2.5 新）；9. **`public[i]` self_public**（v2.5 新——被揭露者/自曝者自知）

**one-hot（:393-394）**：`last_action`（0-7；初始 0=SILENT），索引 9-16。

**近邻块（:416-431，feature-major）**：候选矩阵 `big` = 距离（≤30）否则 ∞；对角 ∞；
非 `known∧alive` 为 ∞（**不滤域内**——域内已知者以真实几何进入）。`order = np.argsort(big)[:, :3]`。
每槽 7 维（列组拼接：[Δx×3, Δy×3, d×3, tech×3, res×3, public×3, in_domain×3]——索引 17+k/20+k/23+k/26+k/29+k/32+k/35+k）：
1. 环面 Δx/50 × dmask；2. Δy/50 × dmask（wrap：`delta −= world·round(delta/world)`）
3. d/50（dmask 否则 0）
4. `log1p(tech)/log1p(50)`，条件 `known_pair ∧ observed[i,·]`，否则 **−1.0**
5. `res/res_max`，同条件，否则 **−1/20 = −0.05**（−1 直接除以 res_max，与第 4 维的裸 −1 不同）
6. `public[目标] × known_pair`
7. `in_domain[目标] × known_pair` ——**恒 0**（Q3）

其中 `known_pair = known ∧ alive(目标) ∧ ¬in_domain(目标)`（:329，**距离无关**）；
`dmask = isfinite(big)`（:332）。**Q13**：候选不足 3 时 ∞ 补位槽的 tech/res/public 取
argsort 第 k 位文明的旗标——内容与补位者是谁**有关**（远处已公开/已观测者的旗标会泄漏），
平局序须逐位复刻 numpy（`numpy-sort.ts`）。不含自身坐标与身份信息（自身 public 经标量 9 进入）。

## 10. info 事件流字段字典（:642-653；游戏渲染数据源）

| 字段 | 类型 | 语义 |
|---|---|---|
| `detections` | [(探测者 i, 被探测者 j)] | 本刻被动探测 + 反曝光新知 |
| `strikes` | [(i, j, killed:bool)] | 未被护盾挡下的打击尝试 |
| `invasions` | [(入侵者, 受害者, mutual:bool)] | 互毁时两条 |
| `strike_events` | [(i, j, "killed"\|"survived"\|"blocked", tech_i, tech_j, shield_take)] | 全量打击事件 |
| `strikes_blocked` | [(i, j, take)] | 被护盾挡下的打击 |
| `loot_to` | (n,) float | 各文明本刻掠夺所得 |
| `died_this_tick` | [(slot, cause)] | cause ∈ strike/invade/mutual/starve |
| `free_pool` | float | 结算后池值 |
| `res_conservation_residual` | float | 守恒残差（Q5） |
| `n_births` / `n_alive` / `in_domain` | int | 计数 |
| `counter_detections` | int | 反曝光实际新增数 |

（BOTHER 揭露无专用 info 字段——推断靠 `pending_reveal`/known 增量；玩家侧"自己揭露了谁"
由游戏层经 `_targets` 记录，见 game-mechanics.md §7 规则①。）

## 11. 终止条件（:640-641）

`done = (t ≥ t_max) ∨ ( 全灭 ∧ free_pool < pending_spawns[0] )` ——定长时间是主时钟；唯一提前
结束是**物理热寂**（v2.5 复用使热寂更罕见但可达）。没有"最后幸存者获胜"判定：独存活者也要
走满 250 刻；玩家目标=活到终局。

## 12. RNG 一致性策略

Python 端单一 `np.random.default_rng`（**PCG64**），构造时定种子；`reset()` 不传种子则**延续**流。
消耗点与顺序（逐位复现必须完整照抄）：

- **reset**：`uniform(0,100,(n,2))` 站位 →（Q1 触发时）每次修复 `uniform(0,100,2)` →
  `uniform(lo,hi,n0)` 初始科技（lo=hi 仍消耗 n0 值）→ `uniform(5,20,n0)` 初始资源 →
  `uniform(5,20)` 首个预滚。
- **resolve**：反曝光 `choice(候选)` → `uniform(n,n)` 探测 → 每个未挡打击一次 `uniform()`（升序）→
  `uniform(n)` 爆炸（无条件）+ 命中时 `uniform(1.6,2.2,k)` → `uniform(n)` 流失（无条件）+
  流失时 `uniform(0.5,2,k)` → 出生时 `uniform(5,20)` 预滚（**v2.4：不再抽取出生科技——每次
  出生少 1 值**）。`begin_tick`/`_obs`/`_valid` 不消耗 RNG。

**已落地双口径验收**（CLAUDE.md 门 3）：①录制-回放金标准——`scripts/golden/record_golden.py`
录制 env2_v24 每次 RNG 调用 + 逐刻全状态快照（7 轨迹，含 d 臂奖励参数路径），TS `ReplayRng`
逐条断言消耗序后重演，全状态精确比对（容差披露 testdata/README）；②统计等价——stats.json
（30 局 presets 池）带宽内。游戏运行时用 GameRng（sfc32）自成体系，金标准不经它。
**argsort 例外**（Q13）：obs 近邻排序非 RNG 但须逐位一致——`numpy-sort.ts` 移植 numpy 1.26.4
introsort（Windows 轮子 MSVC 构建禁 SIMD → 标量 aquicksort_ 路径；其他构建 AVX512 平局序不同，
语义同为伪影），`testdata/argsort-vectors.json`（2005 例）逐位锁定。

## 13. test_strike_fix 行为锁定与移植验收

`experiment/experiment/tests/test_strike_fix.py` 为 v2.3-fix 的回归（打击逻辑 v2.4 未变）；
TS 侧 `src/lib/engine/strike-fix.test.ts` 同断言（rigged 掷骰确定化，见 testdata/README）：

1. **KILL**（tech 20 vs 1 → p=0.95 封顶）：`alive=False` ∧ `death_cause="strike"` ∧ "killed"。
2. **CONSERVATION**：击杀后 `|res_conservation_residual| ≤ 1e-6`。
3. **BLOCK**（tech 10 vs 25，2.5≥2 且双方过门槛）：受害者存活 ∧ "blocked"（零 RNG）。

v2.4 补充锚：`experiment/experiment/smoke_v24.py`（动作/obs 形状、300 tick 随机 rollout、揭露
集成、c 臂奖励公式、无继承）——TS 对应单测见 resolve-b（揭露/显式观测）与 resolve-c（无继承
出生 + res 津贴）。

**v2.5 回归锚**：`experiment/experiment/smoke_v25.py`（OBS_DIM 38、under_attack 滑窗
re_obs[0,7]、self_public o[0,8]、300 tick births>36 复用、复用清除断言）与
`smoke_v25b.py`（v2b 启发式：df 反咬 last_invader、pacifist 藏匿）——TS 对应 env-reuse /
begin-tick / obs 单测；金标准轨迹（v2.5 重录，2026-11-01）含 trace-main-d（159 次出生重度
行使复用路径）。
