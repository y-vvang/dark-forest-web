# 游戏机制设计（阶段：引擎移植 + 一致性验收 + 对手接入 + 单机会话）

状态：v1.0（2026-10-01 用户口头批准设计后成文）。
上游文档：`docs/env-model-v23.md`（环境移植规格，§0 quirk 清单 Q1–Q12）、
`docs/ai-opponents.md`（DQN/预制策略规格）、`DESIGN.md` §13（时序模型）、CLAUDE.md（一致性验收 5 点门）。
冲突时权威顺序：`experiment/experiment/env2.py` > env-model-v23.md > 本文。

本阶段范围：**模式 (a) 单机与智能博弈端到端可玩**。在线模式 (b)（路线第 5 步）不在本阶段。

---

## 1. 模块架构

```
src/lib/engine/        纯 TS 环境（零 React、零 DOM）——DarkForestEnv2 忠实移植
  config.ts            EnvConfig 类型 + V23_CONFIG（逐项对应 config_v23.yaml env 节）
  types.ts             ActionId（0-9 枚举序）、TickInfo（info 字段）、EnvironmentState
  rng.ts               Rng 接口 + GameRng（运行时种子化）+ ReplayRng（测试回放）
  env.ts               DarkForestEnv2：字段名/方法集与 env2.py 一一对应
  snapshot.ts          全状态导出为可比对纯对象（金标准用）+ 视图模型辅助
src/lib/opponents/
  catalog.ts           12 checkpoint + 3 预制策略的静态清单（名称/相对存活/来源，i18n 名走词典）
  dqn.ts               JSON 权重加载 + float64 前向 + 合法掩码 argmax + ε 探索
  presets.ts           random / df / pacifist（train2.py:40-52 + stage_b 目标口径）
src/lib/solo/
  match.ts             会话状态机：座位分配、逐刻驱动、感知过滤、终局判定
  view.ts              环境状态 → UI 视图模型（星图标记/状态栏/日志条目/行动门）
scripts/golden/        开发期 Python（PYTHONUTF8=1，只读引用 experiment/，零改动）
  record_golden.py     录制金标准轨迹（包装 rng，实验自带代理驱动）
  convert_models.py    npz → public/models/<arm>.json（float64 明文数组 + 形状 + 来源）
  record_dqn_outputs.py录制 DQN 前向奇偶数据（随机输入 × 12 模型 → numpy 输出）
src/lib/engine/testdata/   提交进库的金标准数据（gzip JSON）+ README.md（口径披露）
public/models/         12 个模型权重 JSON（Vercel 长缓存静态资产）
```

分层契约：engine 不 import React/opponents/session；opponents 只依赖 engine 的类型与 obs/valid；
session 依赖 engine+opponents；UI 组件只依赖 session 的视图模型。`bun test` 可脱离浏览器跑 engine/opponents/session。

## 2. 随机数设计

### 2.1 接口 = env2.py 实际消耗（全量核对过）

env2.py 只调用两个方法（调用点行号）：

| 调用 | 位置 | 语义 |
|---|---|---|
| `uniform(lo, hi, size?)` | env2.py:169,176,189,190,198,238,247,436(无参→[0,1)),492(标量),569,571,574,576 | 半开区间 [lo,hi)，size 缺省=标量，size=n 或 (n,n) 时 C 序批量 |
| `choice(cand)` | env2.py:412 | 从一维候选数组等概率取一个元素 |

TS `Rng` 接口即此二者（标量/低高/批量/选择四个方法形态）。**不复刻 PCG64/SeedSequence**——运行时用自家 PRNG，测试用回放。

### 2.2 GameRng（运行时）

sfc32（或同级别小 PRNG），种子经 splitmix64 链扩展。契约：`uniform() ∈ [0,1)` 半开；
同一 match seed → 逐位复现同一局。随机流派生约定（写死在 engine 文档注释中）：

```
seedOf(matchSeed, domain):  splitmix64(matchSeed ^ tag(domain))   // domain ∈ "env" | "agent:<slot>" | "model:<arm>"
```

- env 用 `seedOf(S,"env")`；预制策略每席 `seedOf(S,"agent:<slot>")`（同 train2 的 per-slot 流思想）；
  每个 DQN 模型实例（多席共享）一条流 `seedOf(S,"model:<arm>")`，按席位升序批量 act（同 train2 的共享
  DQN 消耗语义）。
- 与 numpy 分布不逐位一致——无需一致：金标准回放不经过 GameRng（用录制值），游戏运行时自成体系。

### 2.3 ReplayRng（测试）

按序弹出录制条目 `{m, args, v}`，断言方法与参数（lo/hi/size/候选集）完全一致后返回录制值；
耗尽或失配 = 测试失败。**由此把"完全复刻调用序"从移植负担变成测试断言。**

## 3. 引擎移植要点

以 `docs/env-model-v23.md` 为基线；本节只记核对 env2.py 后新增的落地细节：

1. **numpy 语义复刻清单**：`np.percentile` 线性插值（h=(m−1)·q；floor/ceil 线性内插，env2.py:241）；
   argmin/argmax 平手取最先（全 +inf 行 argmin 返回 0 → 由 `isfinite` 守卫跳过，env2.py:474-482,552-555）；
   矩阵抽样 C 序（detection 一次 `uniform(size=(n,n))`，行主序展开，env2.py:436）；
   obs 末尾 float32 截断（env2.py:329，TS 用 `Math.fround` 逐元素）。
2. **求和顺序**：`np.sum` 为成对求和，TS 顺序累加的末位差 ~1e-15——状态比对主断言用精确相等 +
   容差 1e-12 兜底（容差即为此披露），守恒门维持 |残差|≤1e-6。
3. **argsort 平手序**：`_obs` 近邻排序（env2.py:311）numpy 快排非稳定；已验证被掩蔽的近邻行输出
   恒为零向量（delta×dmask=0、near_d=0、tech=−1、res/20=−0.05），**不依赖槽位身份**，故平手序差异
   无害。TS 用稳定排序即可。
4. **同刻顺序细节（Q1–Q12 之外，照抄 env2.py）**：护盾不消耗 RNG 且可对"本刻已被击杀但未结算"者
   生效（env2.py:484-489）；同一受害者多个打击者只有首个入 kills（env2.py:495）；OBSERVE 无合法
   目标（argmin 落在 inf）不追加 pending_counter（env2.py:552-555）；互毁双方不发生掠夺（杀手已死，
   env2.py:530-531）；尸体余量（含被掠夺后一半）入自由池（env2.py:589-592）。
5. **状态表示**：n=36 固定（config 驱动）；向量用 `Float64Array`，布尔矩阵用 `Uint8Array`/`boolean[][]`；
   `pending_reveal/pending_counter/pending_spawns/birth_log/_invaders/_targets` 保持原结构。
   36 槽规模下 O(n²) 显式循环即可，无向量化需求。

## 4. 一致性验收落地（5 点门 → 测试清单）

| 门（CLAUDE.md） | 测试 | 机制 |
|---|---|---|
| 1. test_strike_fix 等价 | `engine/strike-fix.test.ts` | 10 种子 × 三断言（击杀置死+死因/守恒/护盾≥2 精确挡下），场景构造同 test_strike_fix.py；击杀掷骰用**rigged Rng**（0.94 → p=0.95 下必中；另设 0.96 → 幸存分支）——比 Python 原版（5% 天然 flake）更严格且无 flake |
| 2. 守恒不变量 | 所有引擎测试内置辅助断言 | 每刻 `总量−Σ存活资源−自由池`，|残差|≤1e-6 全程 |
| 3. 金标准回放 | `engine/golden-replay.test.ts` | **录制-回放**（见 4.1），逐刻全状态+info+obs 精确比对（容差 1e-12 披露） |
| 4. info 字段语义 | golden-replay 内逐字段 + `engine/info-parity.test.ts` | 字段字典逐一（detections/strikes/invasions/loot_to/died_this_tick/strikes_blocked/strike_events/free_pool/res_conservation_residual/n_births/n_alive/in_domain/counter_detections） |
| 5. Q1–Q12 | `engine/quirks.test.ts` | 每 quirk 一用例（站位拒绝采样读旧 pos、known[j,j] 自知、近邻域特征恒 0、风窗免疫、残差为信息字段、反咬无需有效目标、一次性槽位、护盾不耗 RNG……），锚定 env-model-v23.md §0 |

附加门（对手层）：

- `opponents/dqn-parity.test.ts`：TS 前向 vs `record_dqn_outputs.py` 录制的 numpy 输出，
  每模型 × 若干随机输入（含全合法/部分合法 obs），|ΔQ|≤1e-12。
- `engine/stat-equivalence.test.ts`（第二口径，轻量）：TS 自跑 K 局 vs Python 参考聚合
  （`record_golden.py` 顺带产出 stats.json：存活分位/动作频率/击杀数），带宽披露。
  ——录制-回放已确定性覆盖逻辑等价，此项仅防"录制器与被测两端同错"的系统性风险。

### 4.1 录制-回放金标准（决策 ③）

**原理**：不移植 PCG64，改为录制 Python 端每次随机调用的 (方法, 参数, 返回值)；
TS 端 ReplayRng 按序喂入 → 两端走同一条随机性轨迹 → **逐刻全状态精确比对**。
任何公式/顺序/分支偏差立刻确定性爆掉，不需要统计功效。

轨迹格式（gzip JSON，`testdata/*.json.gz`）：

```jsonc
{
  "meta": { "seed": …, "driver": "stage_b|train2-mixed|scripted", "kinds": [...], "modelArms": [...] },
  "reset": { "state": <快照>, "obs": <b64 float32> },
  "ticks": [ {
    "actions": [...], "targets": [...],
    "invaded": [...], "reObs": <b64 float32 或 null>, "reActions": [...],
    "post": { "state": <快照>, "obs": <b64 float32>, "info": {...}, "rewards": [...], "done": bool }
  } ],
  "rngLog": [ { "m": "uniform", "args": [lo, hi, size], "v": <标量或 b64 float64> },
              { "m": "choice", "args": [<候选数组>], "v": <元素值> } ]   // 消耗序
}
```

- **状态快照** = engine 全字段（pos/tech/res/alive/known/observed/public/in_domain/domain_windup/
  pending_reveal/pending_counter/last_action/first_detect_tick/free_pool/pending_spawns/birth_log/
  death_cause/spawn_tick/spawn_tech/spawn_res/peak_tech/t）。
- **驱动代理 = 实验自己的**：`DQNAgent`（真 checkpoint，stage_b 循环）+ `heuristic_action` 预制策略，
  保证动作分布真实（会踩中域、入侵、反咬、出生全部分支）。
- **obs 必录**：回放的动作取自录制而非重算 DQN，故 _obs 移植错误唯一可观测签名就是 obs 本身——
  post-obs 与 re_obs（被入侵时）都比对。
- **轨迹集**（提交进库，约 8MB gzip）：2 个完整 250 刻对局（不同种子、不同池型）+
  4 个定向短局（互毁反咬、护盾挡下、黑域风窗免疫、热寂终局）。录制脚本可随时再生成更多。
- 重新生成：`PYTHONUTF8=1 python3 scripts/golden/record_golden.py`（脚本内 sys.path 只读引用
  experiment/；产物写 src/lib/engine/testdata/）。

### 4.2 口径披露（testdata/README.md）

写明：不移植 PCG64 的原因（SeedSequence/调用序数据依赖 vs 回放等价强度）；"精确相等+1e-12 容差"
的原因（np.sum 成对求和）；obs 平手序豁免论证；stat-equivalence 的带宽与单种子披露；
test_strike_fix 的 rigged-Rng 偏离（Python 原版 5% flake）。

## 5. 对手层

### 5.1 模型资产管线（决策 ①）

- `convert_models.py`：读 12 个 npz（主 + 11 sweep 臂）→ `public/models/<arm>.json`：
  `{ arm, source: <experiment 相对路径>, updates, shapes, W0/b0/W1/b1/W2/b2: <float64 明文数组> }`。
  Python `json.dumps` 的 float repr 与 JS `JSON.parse` 对 float64 逐位往返（IEEE 保证），零损失。
- 运行时按需 fetch（~150KB/模型），`Cache-Control: public, max-age=31536000, immutable`
  （next.config headers 显式声明）——对齐部署约束"checkpoint 静态资产可长缓存"。
- 正确性兜底：dqn-parity 测试逐模型比对 numpy 前向输出。
- 档案内 v2.0–v2.2s checkpoint 一律不转换不引用（36 维旧架构，CLAUDE.md 事故警示）。

### 5.2 DQN 推理（口径：stage_b 评测惯例）

- 前向：float64，38→64(ReLU)→64(ReLU)→10(线性)，权重来自 online__ 系列键（model.py:29-41）。
- act（model.py:146-156）：`q = forward(obs_f64)`；非法动作置 −∞；argmax（平手取先）；
  ε=0.05 探索：先 `uniform(size=B)` 判定探索行，再逐行 `choice(合法)`——**同序消耗**。
- 同一模型的多个席位共享一个实例与一条随机流，按席位升序批量 act（train2.py:55-64 语义）。

### 5.3 预制策略（train2.py:40-52 + stage_b.py:48-52 代码级口径）

| 策略 | 一选 | 目标二选（stage_b） |
|---|---|---|
| random | 合法动作内 `rng.choice` 均匀 | 候选内 `rng.choice` 均匀 |
| df | STRIKE 合法即打 → 否则 OBSERVE 合法且 uniform()<0.3 → 否则 uniform()<0.6 ? DEVELOP : SILENT | `pick_target`：INVADE 取候选最弱、STRIKE 取候选最强（train2.py:25-37 的 df 分支为唯一活代码） |
| pacifist | uniform()<0.5 ? DEVELOP : SILENT | 不适用（合法集不含目标动作） |

被入侵重选（phase-2）：与一选同函数（heuristic_action / agent.act 单行），stage_b.py:55-61。
注意 `pick_target` 中 "random/learner" 分支（cand[0]/argmax）在两个调用方均为死代码——不移植该分支，
learner/random 一律均匀（stage_b.py:52 实际路径）。

## 6. 单机会话层

### 6.1 座位分配与玩家出生

- `env.reset(seed=S)`：初始 4 席 = 所选对手循环填充。
- **玩家 = 下一个内生出生**（出生序 4，通常第 1 刻，因开局自由池均值 ≈100 ≥ 预滚额 ≤20）。
  出生前复用 /online 的幽灵排队视图：只见全局读数（刻/存活/自由池），无任何情报。
  v2.4：出生科技恒 `tech_spawn_lo`=1.0（无继承）；开局配置若拉高 resMin/拉低预算可能推迟出生——
  `start()` 循环自动逐刻推进直至出生或 done（未及诞生分支兜底）。
- 之后每次内生出生继续按所选对手循环。36 席一次性（Q11）；预算 150 保证全期出生 ≤ ~30，玩家席安全。
- 极端兜底：若玩家出生前热寂（对局即 done 而玩家未出生）→ 终局覆盖层"未及诞生"分支（新增文案键）。

### 6.2 逐刻循环（DESIGN §13：单机每刻暂停）

```
1. AI 一选（批量/逐席）+ 玩家一选（ActionGrid；v2.4 目标武装集 = STRIKE/INVADE/REVEAL/OBSERVE：
   候选 = select_targets(actions)[player] 行；INVADE/REVEAL 必须显式目标，STRIKE/OBSERVE 可不选
   =最近已知兜底）
2. begin_tick → invaded[]
3. 受入侵者重选：AI 按其策略；玩家 = 入侵模态（反咬 INVADE / 黑域 BDOMAIN / 保持原动作）
4. resolve(re_actions)
5. 感知过滤（§7）→ UI 事件 + 状态面板 + 星图更新；守恒断言
6. 玩家死亡 → 死亡终局；env done（t≥250 或热寂）→ 存活终局
```

- 玩家死后对局即止（终局覆盖层：死因/存活刻数/击杀/缴获）——死亡即玩家游戏的终点，
  无旁观模式（存活到 250 = 胜，DESIGN §13 与原始需求一致）。
- 终局统计：击杀 = 玩家为攻击者且 killed/invade 成功的计数（info 全知但仅取己方行为结果，§7 规则①）；
  缴获 = Σ loot_to[player]。

### 6.3 确定性

单局种子 S 在开局时生成（crypto 随机）；同 S + 同对手选择 → 逐位复现。种子不进 URL（长且无分享需求），
存会话内存；留 console.log 一行便于排障复现。

## 7. 玩家感知过滤（决策 ②：严格忠实口径）

info 流是全知的；UI 只渲染**该文明在环境机制下真正可知**的信息。原则：宁可玩家少知道，
不给环境没赋予的信息。规则表（已用户批准）：

| # | 可见 | 依据 |
|---|---|---|
| ① | 自己动作的结果：打击被挡/命中/落空、入侵成功、观测所得情报、广播已发出、**揭露已发出（v2.4 log.ownReveal，目标 id 取本刻 _targets）** | 行为者对自身行为的知情权 |
| ② | 入侵通知（含入侵者身份） | env2_v24.py:369-375 显式机制 |
| ③ | 自己的探测增量：新信号 + 坐标（无 tech/res） | known[player,·] 增量 |
| ④ | 任何文明的"公开化"（新标记 + public 标记）——**v2.4 含他人揭露的第三方**（与自曝同形，归因歧义=机制真相：known[alive,j]+public[j] 双路径不可区分，欺骗成立） | pending_reveal → known[alive,j] |
| ⑤ | 世界 HUD：刻数、存活数、自由池 | 刻数/存活数在 obs 中。**自由池不在 obs 中**——保留其显示属游戏层 HUD 偏离：它非对任何文明的情报（是世界物理量），且为已批准的顶栏设计（DESIGN.md §10/§11）；在此明示 |
| ⑥ | 已知信号的消失（known&alive → false 的转换；无死因） | 玩家自身知识图的变化 |

| # | 不可见 | 依据 |
|---|---|---|
| ⑦ | 他人间的探测/打击/死亡（除 ④⑥ 的间接呈现） | 无机制赋予 |
| ⑧ | 被观测反曝光（不知道自己被谁看见） | env2_v24.py:415-431 不通知被观测者 |
| ⑨ | 被打击但幸存（无任何通知） | env 无此信号，**严格忠实** |
| ⑩ | 出生情报：无 #id/资源，仅存活数变化 | 出生不进任何 obs/通知 |
| ⑪ | 他人 tech/res/资源流失/爆炸 | 需 OBSERVE（①中的观测所得） |
| ⑫ | **被揭露**（v2.4）：自己被他人 BOTHER 公开时**零感知**——环境无任何通知机制；known[·,player] 变化不进玩家行（view 只 diff 玩家 known 行） | env2_v24.py:457-472 无信号；测试锁定 view.test "being revealed is INVISIBLE" |

原 mock 键的调整：`log.born` → 情报-free（"一个新文明诞生了"）；`log.blocked` → 仅当**玩家是打击者**时
报"你的打击被护盾挡下"（目标不感知，规则⑨）；新增 `log.dark`（已知信号消失，规则⑥）；
新增 `log.ownStrikeHit/Miss`、`log.ownInvade`、`log.ownBroadcast`、`log.ownReveal`（v2.4 揭露，
规则①）、终局"未及诞生"分支文案。全部新键走 DESIGN.md §7 → en.ts + zh.ts 流程。

### 7.1 游戏层扩展（非感知数据——引擎/机制之外，v2.4 轮新增）

三项功能均为**游戏层**扩展，不触碰引擎 parity：

- **奖励展示**（配置流 + 四臂对比）：引擎 `TickResult.rewardDetail`（TS-only 诊断：techTerm/
  resAtReward/attackCount/bdEnter，在 rewards 计算处顺带记录，**不进 info、不参与录制-回放比对**）
  → `rewards.ts` 组合任意参数集（当前 cfg / 四臂固定参数）。奖励参数不影响对手行为（披露常驻）。
- **模型参谋**：四臂对玩家当前 obs/valid 行 greedy（`dqn.act`，ε=0 零 RNG——不触碰会话随机流）；
  用过即于终局弹窗披露（`end.advisorUsed`）——AI 辅助 = 非独立生存的诚实标记。
- **环境常量配置**：`cfg-io.ts` 精选 25 参数 + 出生科技旋钮；默认恒 = config_v24.yaml，任何改动 =
  对实验的明示偏离（DESIGN §10.14 披露）；差集经 sessionStorage 传递，读取端钳制 + 忽略未知键
  （结构参数 nAgents/world/spawnSchedule 固定——模型观测缩放按默认训练）。

## 8. UI 接线

- `/solo`：多选对手 → `开始对局` → `/match?op=<逗号分隔 id>`（模型 id + preset id）；缺失/非法参数
  → 重定向 /solo。选中模型在开局时按需 fetch（加载态短提示，新增键）。
- `/match`：demo bar 移除（CLAUDE.md 备忘既定）；星图标记 = 玩家 known/observed/public 矩阵的视图
  （认知阶梯五态照旧）；行动格门 = `valid[player]`；状态面板 = 自身标量；日志 = 感知过滤后事件；
  入侵模态 = 玩家 ∈ invaded；终局覆盖层 = 死亡/存活/未及诞生三态。
- 引擎纯客户端运行（单机无后端）；会话状态用 useReducer（事件驱动，React Compiler 友好，
  无 effect 内 setState）。
- `src/lib/mock.ts` 中仍被原型引用的字段随接线逐步退役；图例/文案不动。

## 9. 依赖、命令与资产

- 新增 devDep：`@types/bun`（`bun test` 导入在 tsc --noEmit 下可查）；package.json 增 `"test": "bun test"`。
  运行时依赖零新增。
- 金标准脚本命令（CLAUDE.md 常用命令节同步）：
  `PYTHONUTF8=1 python3 scripts/golden/record_golden.py`、`… convert_models.py`、`… record_dqn_outputs.py`。
- `public/models/` 长缓存 headers 写入 next.config。

## 10. 里程碑与验收

| # | 里程碑 | 完成判据 |
|---|---|---|
| M1 | 引擎移植 + 脚本化用例 | quirks/strike-fix/info-parity/守恒 测试绿（TDD：先测后实现） |
| M2 | 金标准录制 + 回放绿 | **一致性验收门全过（此门不过不接 UI，CLAUDE.md 硬规定）** |
| M3 | 对手层 | dqn-parity 绿；presets/act 与 stage_b 口径一致；模型 JSON 就位 |
| M4 | 会话层 + UI 接线 | 单机全程可玩：排队幽灵→出生→逐刻→入侵模态→终局三态；demo bar 移除 |
| M5 | 收尾 | `bun run check/build/test` 全绿；CLAUDE.md 状态更新；新文案 §7 双语齐；人工走查清单 |

## 11. 决策记录（本阶段新增，均已用户批准）

1. **模型预转换 JSON**（而非运行时解 npz）：运行时零 zip 解析、Vercel 长缓存天然对齐；
   正确性由 dqn-parity 逐模型精确比对兜底。
2. **感知过滤严格忠实**：UI 不渲染环境机制未赋予玩家的信息（规则⑦-⑪）；原型个别 mock 键随之调整。
3. **录制-回放金标准**（而非纯统计等价）：确定性验收，多提交 ~8MB gzip 测试数据换取；
   stat-equivalence 仅作轻量第二口径防系统性同错。
4. **test_strike_fix 的 TS 版用 rigged Rng**（消 5% 天然 flake，见 §4）；RNG 接口 = env2.py
   实际消耗（uniform/choice 两法）；运行时 PRNG 不复刻 numpy（无需复刻——回放走录制值，
   游戏运行时自成体系）。
