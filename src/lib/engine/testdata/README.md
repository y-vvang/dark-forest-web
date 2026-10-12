# testdata 口径披露（一致性验收 · 金标准，v2.4）

生成：`PYTHONUTF8=1 python3 scripts/golden/record_golden.py`（开发期专用；只读引用 `experiment/`）。
机制：录制 env2_v24.py 每一次 RNG 调用（`uniform`/`choice` 的方法+参数+返回值）与逐刻全状态快照；
TS 端 `ReplayRng`（`src/lib/engine/rng.ts`）按序喂入录制值 → 引擎重演同一随机轨迹 →
逐刻全状态/obs/info/rewards 精确比对 + 消耗序断言（`assertExhausted`）。**逻辑偏差确定性爆出，无统计功效依赖。**

v2.4 录制要点（vs v2.3 轮）：轨迹 `meta.cfg` 记录完整 env 参数（奖励臂轨迹自带其
override——TS 回放按 trace 自建 EnvConfig）；驱动循环对齐 `stage_b_v24.py`
（目标请求集 = INVADE/STRIKE/BROADCAST_OTHER/OBSERVE 四动作）；出生无科技继承
（**每次内生出生少消耗 1 个 RNG 值**，v2.3 的 percentile 抽取已不存在）。

## 轨迹清单

| 文件 | 内容 | 备注 |
|---|---|---|
| `trace-main-s1.json.gz` | 完整 250 刻，stage_b 池型（learner=a_classic + random/df/pacifist 各 9） | a_classic = v2.3-fix 原味奖励臂 |
| `trace-main-s2.json.gz` | 完整 250 刻，全 pacifist | 发展/爆炸/出生/饿死长尾 |
| `trace-main-d.json.gz` | 完整 250 刻，stage_b 池型（learner=d_malintent）+ 该臂奖励参数 | 覆盖 BROADCAST_OTHER 揭露 / attack 赏金 / res 津贴路径 |
| `trace-tgt-mutual.json.gz` | 入侵→反咬→互毁 | |
| `trace-tgt-shield.json.gz` | 护盾挡下（零 RNG 消耗） | |
| `trace-tgt-windup.json.gz` | 黑域风窗免疫打击 + 入域后入侵取消 | |
| `trace-tgt-heat.json.gz` | 资源枯竭改造局 → 晚局经济覆盖 | 热寂 done 分支由 `resolve-c.test.ts` 单测锁定 |
| `stats.json` | 统计等价第二口径参考（30 局 presets-only 聚合，v2.4 环境） | 由 stat-equivalence 测试消费 |

另：`dqn-outputs.json`（4 奖励臂 × 10 随机输入的 numpy 前向，`record_dqn_outputs.py`）由
`src/lib/opponents/dqn.test.ts` 消费；`public/models/<arm>.json`（4 臂权重，`convert_models.py`）。

## 容差与口径（与 golden-replay.test.ts 一致）

- **状态快照**：`|Δ| ≤ 1e-12`（`compareState`）。设计为精确相等；1e-12 兜底披露
  numpy `np.sum`（>128 元素才启用成对求和；本引擎规模下为顺序求和，实测逐位一致）与
  TS 顺序累加的末位差可能。实测全程零触发。
- **obs（float32）**：`|Δ| ≤ 1e-6`。两端同为 float64 计算后 fround 截断；1e-6 高于
  f32 eps（~1.2e-7）一个量级，逻辑缺陷产生的偏差远大于此。
- **info 浮点**（shield take、free_pool 等）：`|Δ| ≤ 1e-10`；**rewards**：`|Δ| ≤ 1e-12`。
- **RNG 消耗序**：ReplayRng 逐条断言方法与参数（lo/hi/size/候选集），耗尽校验
  `assertExhausted`——任何抽样增删/换位即刻失败。

## 有意的偏离（相对 Python 参照的既定决策）

1. **不移植 PCG64/SeedSequence**：逐位复刻 numpy 需要移植两层数论结构且消耗序数据依赖
   （位置拒绝采样次数可变）。录制-回放以"同一条随机轨迹 + 全状态比对"给出更强的等价性证明。
2. **test_strike_fix 的 TS 版用 rigged 掷骰**（`strike-fix.test.ts`）：Python 原版
   p=0.95 断言天然 5% flake；TS 以 0.94/0.96 确定化（口径偏离，无 flake）。
3. **runtime PRNG = sfc32**（GameRng），与 numpy 无关——游戏运行时自成体系，
   同种子复现单局即可；金标准不经过 GameRng。
4. **TickResult.rewardDetail（TS-only 诊断）**：引擎在 rewards 计算处顺带记录逐刻
   奖励原料（techTerm/resAtReward/attackCount/bdEnter），供游戏层奖励展示组合任意
   参数集的奖励流。**不进 info、不参与 parity**——录制端无此字段，比对不受影响。

## 轨迹格式扩展：`reset.patch`

定向场景需要在 reset 后塑造状态（known/tech/res/pos/alive/free_pool/pending_spawns），
而纯"动作+RNG"不可得。补丁是**数据**（声明式键值），录制端（`record_golden.py:apply_patch`）
与 TS 回放端（`testdata-io.ts:applyPatch`）在 reset 后执行同一份——回放保持确定。
字段形状：`known: [[i,j]]`、`tech/res: [[slot,v]]`、`pos: [[slot,x,y]]`、`alive: [[slot,0|1]]`。

## 已由本门捕获并修复的移植缺陷（历史记录）

1. 近邻块布局：`np.concatenate(axis=-1)` 拼的是 (n,NEAR_K) 列组 → **feature-major**
   （[Δx×3, Δy×3, d×3, tech×3, res×3, public×3, in_domain×3]），非逐邻居 7 元组。
2. **域内目标的近邻几何**：`big` 矩阵不滤域内者——已知+存活的域内目标以真实
   Δx/Δy/d 进入观测；仅 tech/res/public/in_domain 情报特征被 known_pair 掩蔽。
3. **percentile 插值分支**（v2.3 历史机制，v2.4 已随无继承删除）：numpy `_lerp` 在
   t≥0.5 走 `b−(b−a)·(1−t)`（数值优化路径），须照抄才能逐位一致。
