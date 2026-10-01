# AI 对手移植规格（DQN 推理 + 预制策略 + checkpoint 资产）

> **用途**：游戏模式 (a)（与智能博弈）的对手实现规格。来源（均为 v2.3-fix 权威口径）：
> `experiment/experiment/model.py`（DQN）、`train2.py`（启发式 + 两阶段训练）、`stage_b.py`
> （混合池评测，游戏对手行为的**口径基准**）、`data2.py`（config 工厂）。配套：`docs/env-model-v23.md`。

## 1. DQN 推理移植（model.py）

### 网络（model.py:18-54）

- 结构 `sizes = [obs_dim] + hidden + [n_actions]` = **[38, 64, 64, 10]**；两个隐层 ReLU、
  输出层线性（Q 值）；全参数 **float64**。文件头 docstring"24→64→64→5"是 v1 时代过时文案，勿理。
- 前向（TS 全部所需）：

```ts
h1 = relu(x @ W0 + b0)      // (B,38) -> (B,64)
h2 = relu(h1 @ W1 + b1)     // (B,64) -> (B,64)
q  = h2 @ W2 + b2           // (B,64) -> (B,10)
```

- 无独立观测编码器：**直接使用环境的 obs（38 维）与 valid 掩码**（env-model-v23.md §9/§4）。
  obs 在 env 内已是 float32；`act` 内部转 float64 再前向（model.py:148）。

### 动作选择（model.py:146-156，游戏逐行照抄）

```text
q[¬valid] = −∞ → argmax（并列取最低索引）
explore: rng < ε 的行 → 从该行合法动作中均匀随机选一个（ε 探索也只在合法动作内）
```

- 评测惯例 **ε=0.05**（stage_b.py:110、evaluate2、evidence 全一致）；游戏对手取 ε=0 即完全
  确定性（贪心）；两者行为差异需在对手描述中注明。
- 仅用 **online** 网络（`DQNAgent.online`）；target 网络是训练副本，checkpoint 里没有。
- 训练超参（γ/lr/replay/Adam/Huber/梯度裁剪等）与推理无关，游戏**不需要**移植。

### checkpoint.npz 格式（model.py:203-205；已实测加载验证）

| 键 | 形状 | dtype |
|---|---|---|
| `online__W0` | (38, 64) | float64 |
| `online__b0` | (64,) | float64 |
| `online__W1` | (64, 64) | float64 |
| `online__b1` | (64,) | float64 |
| `online__W2` | (64, 10) | float64 |
| `online__b2` | (10,) | float64 |
| `updates` | () 标量 | int64（主 checkpoint = 149985） |

**容器**：`np.savez` = **无压缩 ZIP**（全部成员 STORED），每键一个 `.npy` 成员
（`online__W0.npy`…），.npy v1.0 格式：6 字节 magic `\x93NUMPY` + 版本 2 字节 + uint16-LE 头长 +
ASCII 字典头（`{'descr': '<f8', 'fortran_order': False, 'shape': (…), }`）+ 小端 float64 C 序数据。

**TS 加载两案**：
- 运行时：任意 zip 读取器（无需解压）+ `.npy` 头解析 + `DataView.getFloat64(v, true)`；
- 或构建期用本机 Python 预转 JSON/二进制（`python3` 3.12.10 已装 numpy），避免引入 zip 依赖。

注意：`DQNAgent.load`（model.py:207-212）不校验形状——**只有 v23_fix 系 checkpoint 兼容**
（38 维 obs / 10 动作）；档案内 v2.0–v2.2s 的是 (36,64)/(64,8) 旧架构（58,172 B），不可用。
checkpoint 旁没有 config 文件——训练出处见 `scripts/pipeline_v23_fix.sh:17-18`。

## 2. 预制策略精确规则（train2.py:25-52；各运行器共享同一实现）

### `heuristic_action(kind, obs, valid, env, i, rng, t)`（train2.py:40-52）

- **random**：从 `valid[i]` 的合法动作中**均匀**随机选（实际分布 ≈ 各 1/3 SILENT/DEVELOP/
  BLACK_DOMAIN——tech>5 后 BDOMAIN 合法）。
- **df**（黑暗森林启发式，"教科书策略"参照系）：
  1. `valid[i, STRIKE]`（=4）为真 → **必打**（无概率）；
  2. 否则 `valid[i, OBSERVE]` 且 `rng < 0.3` → OBSERVE；
  3. 否则 `rng < 0.6` → DEVELOP，否则 SILENT。
  - df 从不使用 STRIKE_WEAK/STRONG、INVADE、BROADCAST、BLACK_DOMAIN；其激进性完全由环境
    门槛（tech>7、有已知目标）界定。
- **pacifist**：`rng < 0.5` → DEVELOP，否则 SILENT；永不攻击、永不上广播/观测。

### 目标选择（第二段决策）

`pick_target(mask_row, kind, tech, act)`（train2.py:25-37）：df 入侵=候选中**科技最低**者（安全猎杀）、
打击=候选中**科技最高**者（诅咒领跑者）；random/learner 训练口径=INVADE 取 `cand[0]`、STRIKE 取
argmax tech——但**评测（stage_b.py:47-52）中 learner 与 random 的目标一律均匀随机**。游戏按
stage_b 口径：**learner/random 均匀随机选目标；df 打最强、入侵最弱**。

### 两口径差异的根因（README"0.832 vs 0.60–0.67"）

`stage_b.py:48` 对 `A_INVADE | A_STRIKE` 行设显式目标 → df 的打击拿到"最强者"目标；
`evidence_v21.py:45` 与 `evaluate2.py:39` 却对 `A_INVADE | A_BOTHER` 行设目标，而 BOTHER(3) 已退役
→ df 的打击**没有显式目标** → env 回退"最近已知"（env2.py:478-480）。诅咒领跑者（stage_b）比
就近猎杀（evidence）存活更高。**跨口径数字不可比；游戏实现 = stage_b 口径。**

### RNG 与重选

- 训练：每文明独立流 `default_rng(seed*100+i)`（train2.py:120）；评测：全池共享一个 rng。
- **被入侵者的重选**（两阶段协议第 5 步）：启发式对手用 `heuristic_action` 以"已知入侵者"的新
  obs/valid 重选；learner 用 DQN 重选（ε 同）；被入侵者重选 INVADE 即互毁（无需合法目标）。
  人类玩家同理（这是游戏最重要的决策时刻）。

## 3. checkpoint 资产清单（12 个可用）

主 checkpoint（`experiment/runs/v23_fix/seed42_main/checkpoint.npz`，60,236 B）：**600 回合同质
自博弈**（`train2.py --seed 42 --mode main --config config_v23.yaml`），学习者训练全程**零打击**。
11 个 sweep 臂（`experiment/runs/v23_fix_sweep_arms/<臂>/run/seed42_main/checkpoint.npz`，各
60,236 B，150 回合短臂，config.yaml 随臂保存）——池存活为 **2 世界×40 ep 相对口径**（仅臂间可比）：

| 臂 | 覆盖参数 | 池存活（learner） |
|---|---|---|
| `base_control` | 无覆盖（对照） | 0.669 |
| `shield025` | shield_cost_frac=0.25 | **0.775（最佳）** |
| `shield075` | shield_cost_frac=0.75 | 0.613 |
| `scale005` | softsign_reward_scale=0.005 | 0.747 |
| `scale02` | 0.02 | 0.612 |
| `budget100` | res_total_budget=100（贫瘠） | 0.683 |
| `budget200` | 200（富饶） | 0.707 |
| `lr3e4` | lr 3e-4 | 0.618 |
| `lr12e3` | lr 1.2e-3 | 0.522（唯一劣于 random 的训练失败臂） |
| `gamma099` | γ=0.99 | 0.753 |
| `gamma0999` | γ=0.999 | 0.580 |

⚠️ `archive_incident_20260922/runs/` 内的 v2.0–v2.2s checkpoint（58,172 B，36 维 obs/8 动作）与
v1.x checkpoint（24 维/5 动作）均与现环境**不兼容**，不可加载。

**对手呈现建议**：对手强度/风格引用权威数字时必须带"单训练种子（42）+ 相对口径"披露。
主 checkpoint（600 ep 长臂）的 stage_b 口径池存活 0.627；画像 = "科技竞速者"（SILENT 0.525 /
DEVELOP 0.464 / BLACK_DOMAIN 0.01，零打击、牙齿仅用于入侵 0.19 次/回合、唯一有缴获者 loot 5.73）。
权威结论（experiment_report.md 第六部分）：learner 0.627 > random 0.514 > df 0.418 > pacifist 0.369；
df 场均 15.7 杀但零缴获、存活垫底——"教科书式森林=自杀"（森林真点燃，先发打击仍净害）。

## 4. stage_b 评测口径（游戏对手行为的基准）

- **池型**：36 槽按 `["learner","random","df","pacifist"]` 循环各 9（stage_b.py:19-21）。
- **种子**：env seed 21001、agent seed 1001、策略 rng 21001；ε=0.05；150 回合（stage_b.py:101-110）。
- **存活率**：`alive_ticks / (t_max − spawn_tick)`（按文明平均，stage_b.py:116）。
- **产物 schema**（`experiment/results/v23_fix/`）：
  - `stage_b.json`：`survival_by_kind`（各 kind 的 survival/loot_mean/kills_mean）、
    `learner_action_profile`（10 动作频率）、`learner_strikes/invades_per_episode`、
    `survival_by_spawn_tech_class`（low/mid/high）、`per_episode[]` 逐回合明细。
    （已知小 bug：`learner_strike_after_detect_rate` 是一元组，stage_b.py:138-139。）
  - `analysis.json`：`action_profiles_by_kind`、`strike_resolution_by_tech_ratio`
    （1–1.5 命中 66%、1.5–2 命中 16%、≥2 全挡；击杀合计 1,987）、`survival_by_birth_tick`、
    `survival_by_peak_tech`。
  - `sweep.json`：`{臂: {override, loss_last50, pool_survival_2worlds40eps, arm_dir}}`。
- **运行器差异（引用纪律）**：stage_b 为唯一"混合池"权威评测；`evaluate2.py` 是 v2.0 时代同质池
  评测器（env seed 10000+policy_seed、12 槽），其 mixed `survival_by_kind` 是死代码（恒 null）、
  `loot_total` 被 ×0；`evidence_v21.py`（seeds 100555/100556、rng 777）度量打击能力可达率与死因
  构成。跨版本/跨运行器比较一律 stage_b 口径；`analysis.json` 的画像/分箱与 `stage_b.json` 的
  存活率不可混用；sweep 短臂仅可相对比较。
- **训练期指标**（`metrics.jsonl`，每回合一行；如需对比训练健康度）：episode/eps/return/
  mean_alive_frac/final_alive/action_freqs（10 键含 "BROADCAST_OTHER(retired)": 0）/strike_per_100/
  invade_per_100/observe_per_100/mutual_per_100/p_strike_after_detect/strikes_by_invader_class/
  loss(EMA)/wall_s/kinds（仅第 1 回合）。`train_log.txt` 每 50 回合一行的精简版
  （终行：ep 600/600 | ret 59.6 | alive 0.382 | … | 443s）。
