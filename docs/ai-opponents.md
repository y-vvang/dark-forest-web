# AI 对手移植规格（DQN 推理 + 预制策略 + checkpoint 资产，v2.4）

> **用途**：游戏模式 (a)（与智能博弈）的对手实现规格。来源（均为 v2.4 权威口径）：
> `experiment/experiment/model.py`（DQN，共享文件仅 n_valid 参数化）、`train2_v24.py`（启发式 +
> 自博弈训练）、`stage_b_v24.py`（混合池评测，游戏对手行为的**口径基准**）、`data2_v24.py`
> （config 工厂）、`reports/v24_arms_brief.md`（四臂画像）。配套：`docs/env-model-v23.md`。
> ⚠️ v2.3-fix 的 12 个 checkpoint（38 维 obs/10 动作）已与现环境不兼容——游戏对手仅保留 v2.4 四臂。

## 1. DQN 推理移植（model.py）

### 网络（model.py:18-54）

- 结构 `sizes = [obs_dim] + hidden + [n_actions]` = **[36, 64, 64, 8]**；两个隐层 ReLU、
  输出层线性（Q 值）；全参数 **float64**。TS 端 `dqn.ts` 维度自权重推导（W0 行 = obs 维、
  b2 长 = 动作数），不硬编码。
- 前向（TS 全部所需）：

```ts
h1 = relu(x @ W0 + b0)      // (B,36) -> (B,64)
h2 = relu(h1 @ W1 + b1)     // (B,64) -> (B,64)
q  = h2 @ W2 + b2           // (B,64) -> (B,8)
```

- 无独立观测编码器：**直接使用环境的 obs（36 维）与 valid 掩码**（env-model-v23.md §9/§4）。
  obs 在 env 内已是 float32；`act` 内部转 float64 再前向。
- v2.4 目标请求集 = {INVADE, STRIKE, BOTHER, OBSERVE}（模型对手的观测/揭露亦带目标）。

### 动作选择（model.py:146-156，游戏逐行照抄）

```text
q[¬valid] 排除 → argmax（并列取最低索引）
explore: rng < ε 的行 → 从该行合法动作中均匀随机选一个（ε 探索也只在合法动作内）
```

- 评测惯例 **ε=0.05**（stage_b_v24.py:111）。游戏对手沿此口径（`EVAL_EPSILON`）。
- 参谋路径（`dqn.act`，2026-10-10 用户需求）：单行 **ε=0 greedy**，零 RNG 消耗——与对局
  随机流完全隔离。
- 仅用 **online** 网络；target 网络是训练副本，checkpoint 里没有。训练超参与推理无关。

### checkpoint.npz 格式（model.py:203-212）

| 键 | 形状 | dtype |
|---|---|---|
| `online__W0` | (36, 64) | float64 |
| `online__b0` | (64,) | float64 |
| `online__W1` | (64, 64) | float64 |
| `online__b1` | (64,) | float64 |
| `online__W2` | (64, 8) | float64 |
| `online__b2` | (8,) | float64 |
| `updates` | () 标量 | int64（四臂均 149,987） |

容器与转换：`np.savez`（无压缩 ZIP）→ 游戏构建期经 `scripts/golden/convert_models.py` 预转
`public/models/<arm>.json`（float64 repr↔JSON.parse 逐位往返；immutable 长缓存）。转换完整性由
`dqn.test.ts` 对 `testdata/dqn-outputs.json`（4 臂 ×10 输入 numpy 前向）逐模型 |ΔQ|≤1e-9 锁定。

## 2. 预制策略精确规则（train2_v24.py:40-52；各运行器共享同一实现）

### `heuristic_action(kind, obs, valid, env, i, rng, t)`

- **random**：从 `valid[i]` 的合法动作中**均匀**随机选——v2.4 合法集含 BOTHER（揭露）。
- **df**（黑暗森林启发式，"教科书策略"参照系）：
  1. `valid[i, STRIKE]`（=4）为真 → **必打**（无概率）；
  2. 否则 `valid[i, OBSERVE]` 且 `rng < 0.3` → OBSERVE；
  3. 否则 `rng < 0.6` → DEVELOP，否则 SILENT。
  - df 不主动使用 BOTHER/INVADE/BROADCAST/BLACK_DOMAIN；激进性完全由环境门槛界定。
- **pacifist**：`rng < 0.5` → DEVELOP，否则 SILENT；永不攻击。

### 目标选择（第二段决策）

`pick_target(mask_row, kind, tech, act)`（train2_v24.py:25-37）：**df → INVADE 取候选科技最低者
（安全猎杀）、其余目标动作（STRIKE/BOTHER/OBSERVE）取候选科技最高者（诅咒领跑者）**；
random/learner 训练口径的 cand[0]/argmax 分支在两个调用方均为死代码，不移植。评测
（stage_b_v24.py:48-52）中 **learner 与 random 的目标一律均匀随机**。游戏按此口径。

### 两口径差异（v2.3 历史，v2.4 已消解）

v2.3 中 evidence/evaluate2 对退役 BOTHER 设目标导致 df 打击退化为"最近已知"；v2.4 BOTHER
复活后 stage_b_v24 与 train2_v24 的目标请求集一致（4 动作），该分歧不复存在。跨版本数字
仍不可比（环境机制+参数双重变化，见简报 §5 披露）。

### RNG 与重选

- 评测：全池共享一个 rng（stage_b_v24.py:110，`default_rng(21001)`）；游戏 `presetRng` 单流同构。
- **被入侵者的重选**（两阶段协议第 5 步）：启发式对手以"已知入侵者"的新 obs/valid 重选；
  learner 用 DQN 重选（ε 同）；重选 INVADE 即互毁（无需合法目标）。人类玩家同理。

## 3. checkpoint 资产清单（v2.4 四奖励臂）

四臂均为 **600 回合同质自博弈**（`run_v24_arms.py` 幂等驱动，seed 42，各 58,172 B）：
`experiment/runs/v24_arms/<arm>/run/seed42_main/checkpoint.npz`；环境参数 = `runs/v24_arms/<arm>/config.yaml`
（= config_v24 + 该臂奖励 override，游戏经 `V24_ARMS` 引用）。

| 臂 | 奖励 override | learner 动作画像（stage_b_v24 150ep 混战池） | 池存活（learner） |
|---|---|---|---|
| `a_classic` | —（soft 0.01 · bd 0.5） | 静默 0.622 + 种田 0.363，入侵 2.95/ep、loot 15.7 | 0.478 |
| `b_terminal` | soft 0 · bd 0 | 纯静默 0.819 + 种田 0.108 | 0.342 |
| `c_res` | +res 0.0025 | **掠夺流**：静默 0.720 + 种田 0.258，入侵 11.08/ep、loot 59.5 | 0.376 |
| `d_malintent` | c + attack 0.5 | **信息战**：静默 0.794、**揭露 0.181**、种田 0.019，入侵 4.17/ep | 0.296 |

⚠️ v2.3-fix 12 checkpoint 与档案内 v2.0–v2.2s、v1.x 均与现环境不兼容，不可加载。

**对手呈现口径**（2026-10-10 用户修订）：对手卡内联**动作画像**而非胜率（相对口径数字有误导性）；
引用任何数字必须带"单训练种子（42）+ 150ep 混战池"披露。权威结论（experiment_report.md
第七部分 / v24_arms_brief.md）：**v2.4 池生态反转——pacifist 0.51–0.58 四臂全居首，learner
掉至第三（0.30–0.48），random 崩至 0.05–0.07**；learner 全臂零打击、恶意表现为"揭露+入侵"；
c 臂资源奖励造就掠夺机器（生存不升反降）；d 臂恶意文明如约养成（生存最低）；earned-tech 分层
high 0.83–0.92 ≫ low 0.13–0.18。预制画像：df 能打必打专攻最强者（14.5 杀/ep、零缴获）；
pacifist 只发展或静默；random 合法集内均匀。

## 4. stage_b_v24 评测口径（游戏对手行为的基准）

- **池型**：36 槽按 `["learner","random","df","pacifist"]` 循环各 9（stage_b_v24.py:19-21）。
- **种子**：env seed 21001、agent seed 1001、策略 rng `default_rng(21001)`；ε=0.05；150 回合。
- **存活率**：`alive_ticks / (t_max − spawn_tick)`。
- **分层**：v2.4 无科技继承 → spawn_tech 分层退化，改按 **peak_tech（earned tech）** 分层
  （`survival_by_earned_tech_class`，low<3.5/mid<7/high≥7——data2_v24.tech_class）。
- **产物**：`results/v24_arms/<arm>/stage_b.json` + `summary.json`（曾因 fork 并行写竞态丢臂，
  已从四臂 json 无损重建并修复驱动——简报 §5 披露）。
- 150ep 下 pacifist/df 差距未做显著性检验，按描述性结果对待；跨版本比较（vs v2.3-fix 0.627）
  未控环境差异——机制+参数双重变化，不构成翻案。
