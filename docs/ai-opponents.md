# AI 对手移植规格（DQN 推理 + 预制策略 + checkpoint 资产，v2.5）

> **用途**：游戏模式 (a)（与智能博弈）的对手实现规格。来源（均为 v2.5 权威口径）：
> `experiment/experiment/model.py`（DQN，共享文件仅 n_valid 参数化）、`stage_b_v25b.py`
> （**v2b 启发式**——用户 2026-11-01 裁定"手写启发式策略跟随实验更新"；v2.4 规则的
> train2_v25 仅训练用）、`data2_v25.py`（config 工厂）、`reports/v25_brief.md` +
> `reports/v30_brief.md`（画像）。配套：`docs/env-model-v23.md`。
> ⚠️ v2.4 四臂（36 维 obs）与 v2.5 env（38 维）不兼容——已退役，游戏对手 = **v2.5 四臂
> + v3.0 champion**（用户 2026-11-01）。

## 1. DQN 推理移植（model.py）

### 网络（model.py:18-54）

- 结构 `sizes = [obs_dim] + hidden + [n_actions]` = **[38, 64, 64, 8]**；两个隐层 ReLU、
  输出层线性（Q 值）；全参数 **float64**。TS 端 `dqn.ts` 维度自权重推导（W0 行 = obs 维、
  b2 长 = 动作数），不硬编码——v2.5 (38,64) 与潜在 v3.3 宽网 (38,128/192) 同码可用。
- 前向（TS 全部所需）：

```ts
h1 = relu(x @ W0 + b0)      // (B,38) -> (B,64)
h2 = relu(h1 @ W1 + b1)     // (B,64) -> (B,64)
q  = h2 @ W2 + b2           // (B,64) -> (B,8)
```

- 无独立观测编码器：**直接使用环境的 obs（38 维）与 valid 掩码**（env-model-v23.md §9/§4）。
  obs 在 env 内已是 float32；`act` 内部转 float64 再前向。
- 目标请求集 = {INVADE, STRIKE, BOTHER, OBSERVE}（模型对手的观测/揭露亦带目标）。

### 动作选择（model.py:146-156，游戏逐行照抄）

```text
q[¬valid] 排除 → argmax（并列取最低索引）
explore: rng < ε 的行 → 从该行合法动作中均匀随机选一个（ε 探索也只在合法动作内）
```

- 评测惯例 **ε=0.05**（stage_b_v25b.py:171）。游戏对手沿此口径（`EVAL_EPSILON`）。
- 参谋路径（`dqn.act`，2026-10-10 用户需求）：单行 **ε=0 greedy**，零 RNG 消耗——与对局
  随机流完全隔离；v2.5 起参谋遍历 **MODEL_IDS**（四臂 + champion，用户 2026-11-01）。
- 仅用 **online** 网络；target 网络是训练副本，checkpoint 里没有。训练超参与推理无关。

### checkpoint.npz 格式（model.py:203-212）

| 键 | 形状 | dtype |
|---|---|---|
| `online__W0` | (38, 64) | float64 |
| `online__b0` | (64,) | float64 |
| `online__W1` | (64, 64) | float64 |
| `online__b1` | (64,) | float64 |
| `online__W2` | (64, 8) | float64 |
| `online__b2` | (8,) | float64 |
| `updates` | () 标量 | int64（v2.5 四臂 149,987；champion 249,789） |

容器与转换：`np.savez`（无压缩 ZIP）→ 游戏构建期经 `scripts/golden/convert_models.py` 预转
`public/models/<id>.json`（float64 repr↔JSON.parse 逐位往返；immutable 长缓存）。转换完整性由
`dqn.test.ts` 对 `testdata/dqn-outputs.json`（**5 模型** ×10 输入 numpy 前向）逐模型 |ΔQ|≤1e-9 锁定。

## 2. 预制策略精确规则（**v2b**，stage_b_v25b.py:35-71；游戏与金标准录制器同用此版锁奇偶）

### `heuristic_action_v2(kind, obs, valid, env, i, rng, t)` —— 决策输入含 v2.5 自身态

- **random**：从 `valid[i]` 的合法动作中**均匀**随机选——无信息对照，不变。
- **df**（黑暗森林启发式，"教科书策略"参照系）：
  1. `valid[i, STRIKE]`（=4）为真 → **必打**（无概率）；
  2. 否则 `valid[i, OBSERVE]` 且 `rng < 0.3` → OBSERVE；
  3. 否则 **v2b 反咬**：`under_attack[i] ∧ valid[i, INVADE] ∧ last_invader[i] ≥ 0 → INVADE`
     （下刻咬回上一刻的入侵者；零 RNG、跳过 0.6 抽签）；
  4. 否则 `rng < 0.6` → DEVELOP，否则 SILENT。
- **pacifist**：**v2b 藏匿**——`hiding = under_attack[i] ∨ public[i]`（被入侵/被公开）→
  `valid[BD] ∧ ¬in_domain` 时声明黑域（tech≤5 门未过则回退静默）；已在域或藏匿期恒 SILENT
  （零 RNG、跳过 0.5 抽签）；未受威胁 50/50 DEVELOP/SILENT，永不攻击。

### `pick_target_v2(mask_row, kind, tech, act, i, env)`

- **df 反咬目标**：`df ∧ act==INVADE ∧ under_attack[i]` 且 `last_invader[i] ∈ 候选` → 咬它；
- 否则 df：INVADE 取候选**最弱**（安全猎杀）、其余目标动作（STRIKE/BOTHER/OBSERVE）取候选
  **最强**（诅咒领跑者）；
- random / 模型对手 → 均匀 `rng.choice`（stage_b_v25b.py:102）。
  ⚠️ `pick_target_v2` 的 "random/learner" 分支（cand[0]/argmax）在调用方为死代码，不移植。

### RNG 与重选

- 评测：全池共享一个 rng（stage_b_v25b.py:170，`default_rng(21001)`）；游戏 `presetRng` 单流同构。
- **被入侵者的重选**（两阶段协议第 5 步）：启发式对手以"已知入侵者"的新 obs/valid 重选
  （v2b 分支含 under_attack → df 受害者会立即反咬）；learner 用 DQN 重选（ε 同）；重选
  INVADE 即互毁（无需合法目标）。**人类玩家 v2.5 起可重选任意合法动作**（动作格重选模式，
  用户 2026-11-01）——目标不可重选（沿用本刻原目标/最近已知兜底）。

## 3. checkpoint 资产清单（v2.5 四奖励臂 + v3.0 champion）

**四臂**均为 **600 回合同质自博弈**（`run_v25_arms.py`，seed 42，各 59,196 B）：
`experiment/runs/v25_arms/<arm>/run/seed42_main/checkpoint.npz`；环境参数 = `runs/v25_arms/<arm>/config.yaml`
（= config_v25 + 该臂奖励 override——臂值与 v2.4 相同，游戏经 `V25_ARMS` 引用）。

| 臂 | 奖励 override | learner 动作画像（last-50ep 训练画像，v25_brief §3） | 池存活（learner，主跑 StageB） |
|---|---|---|---|
| `a_classic` | —（soft 0.01 · bd 0.5） | 种田 0.76 + 静默 0.12，入侵 1.0/100 | 0.562 |
| `b_terminal` | soft 0 · bd 0 | 静默 0.43 + 种田 0.36 + 揭露 0.10 | **0.621** |
| `c_res` | +res 0.0025 | **掠夺流**：种田 0.73 + 静默 0.08，入侵 6.45/100 | 0.487 |
| `d_malintent` | c + attack 0.5 | **信息战纯化**：揭露 **0.807** | 0.556 |

**v3.0 champion**（用户 2026-11-01 入目录 + 在线轮替 + 参谋）：
`experiment/runs/v3/v30_champion/run/seed42_champion/checkpoint.npz`（59,196 B，updates 249,789）。
league 训练（`train2_v30_champion.py`）：1000ep、config_v25 缺省奖励（= 经典参数）、每回合
36 槽 = 12 learner + 24 对手从 7 类池（random/df/pacifist/四臂冻结网）重抽。**诚实负结果**
（v30_brief）：league 对 random 0.584 / pacifist 0.538 / df 0.484，但**输给全部四臂**
（0.312–0.360）——"最能打"未达成（v3.2 五轴 sweep 裁定结构性不可达）；**剩余价值 = "见过
所有策略家族的泛化体"**——游戏 AI 居民可用的多样但不统治的对手。

⚠️ v2.4 四臂（36 维）与 v2.3-fix 12 checkpoint 均与 v2.5 env 不兼容，已退役不可加载。

**对手呈现口径**（2026-10-10 用户修订，沿袭）：对手卡内联**动作画像**而非胜率；引用任何数字
必须带"单训练种子（42）"披露。v2.5 权威结论（v25_brief）：**pacifist 仍四臂全居首**
（0.607–0.672，v2b 启发式 StageB）；学习者对 under_attack/self_public 新状态**零利用**
（−3.1~0pp——"信息完备 ≠ 策略完备"）；死槽复用带来"遗忘效应"——random 生存 0.05→0.28–0.39；
d 臂揭露流 0.181→0.807 转正（唯一正收益臂）。预制画像（v2b）：df 能打必打 + 被咬必反咬；
pacifist 受威胁即藏匿（黑域）；random 均匀。

## 4. stage_b_v25b 评测口径（游戏对手行为的基准）

- **池型**：36 槽按 `["learner","random","df","pacifist"]` 循环各 9（build_pattern 同 v2.4）。
- **种子**：env seed 21001、agent seed 1001、策略 rng `default_rng(21001)`；ε=0.05；150 回合。
- **存活率**：`alive_ticks / (t_max − spawn_tick)`；**v2.5 逐代口径**——死槽复用使一个槽
  承载多代，出生刻重置该槽的 alive_ticks/loot/kills/first_detect（统计属当前住客；
  与 v2.4 数字不完全可比——简报 §7 披露）。
- **分层**：按 **peak_tech（earned tech）** 分层（low<3.5/mid<7/high≥7）。
- **两套启发式批次**：主跑 StageB 用 v2.4 旧启发式（run_v25_arms.py 批内一致）、h2 追加
  用 v2b（run_v25_stageb_h2.py）——游戏取 v2b（实验的最终启发式实现）。
- 产物：`results/v25_arms/`（主跑）+ `results/v25_arms_h2/`（v2b）；单种子描述性结果，
  不下显著性结论；跨版本比较未控口径差异，不构成翻案。
