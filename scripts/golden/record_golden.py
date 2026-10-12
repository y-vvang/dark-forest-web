#!/usr/bin/env python3
"""录制-回放金标准（v2.4）：录制 env2_v24.py 每一次 RNG 调用（uniform/choice）+ 逐刻全状态快照。

开发期专用（PYTHONUTF8=1 python3 scripts/golden/record_golden.py）。
只读引用 experiment/（sys.path），零改动。产出写入 src/lib/engine/testdata/：

  trace-main-s1.json.gz   完整 250 刻：stage_b 池型（learner=a_classic + random/df/pacifist）
  trace-main-s2.json.gz   完整 250 刻：全 pacifist（无 DQN；发展/爆炸/出生长尾）
  trace-main-d.json.gz    完整 250 刻：d_malintent 池 + 该臂奖励参数
                          （覆盖 BROADCAST_OTHER 揭露 / attack 赏金 / res 津贴路径）
  trace-tgt-mutual.json.gz 定向：入侵反咬互毁
  trace-tgt-shield.json.gz 定向：护盾挡下（零 RNG 消耗）
  trace-tgt-windup.json.gz 定向：黑域风窗免疫打击/入侵
  trace-tgt-heat.json.gz  定向：资源枯竭 → 热寂/晚局
  stats.json             统计等价第二口径的参考聚合（30 局 presets-only）

v2.4 变更（vs v2.3 录制）：驱动循环对齐 stage_b_v24（目标请求集 = INVADE/STRIKE/
BROADCAST_OTHER/OBSERVE 四动作；df→pick_target，其余 rng.choice）；meta.cfg 记录完整
env 参数（TS 回放按 trace 自建 EnvConfig，奖励臂轨迹自带其参数）；出生无科技继承
（每出生少消耗 1 个 RNG 值）。

格式（docs/game-mechanics.md §4.1 + reset.patch 扩展）：
  { meta, reset: { patch?, state, obs }, ticks: [...], rngLog: [...] }
reset.patch：两端（录制/TS 回放）在 reset() 后执行的同一声明式补丁——定向场景需要
塑造 known/tech/res，而补丁是数据、非过程，故回放保持确定。
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import sys

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "experiment", "experiment"))

import data2_v24 as dm  # noqa: E402
from env2_v24 import A_BOTHER, A_INVADE, A_OBSERVE, A_STRIKE  # noqa: E402
from model import DQNAgent  # noqa: E402
from stage_b_v24 import build_pattern  # noqa: E402
from train2_v24 import heuristic_action, pick_target  # noqa: E402

TARGET_ACTIONS = (A_INVADE, A_STRIKE, A_BOTHER, A_OBSERVE)  # v2.4 目标请求集（4 动作）

CFG = dm.load_config(os.path.join(REPO, "experiment", "experiment", "config_v24.yaml"))
OUT = os.path.join(REPO, "src", "lib", "engine", "testdata")

# v2.4 四奖励臂：checkpoint + 该臂训练时的完整 config（env 节含奖励 override）
ARMS = {}
for arm in ["a_classic", "b_terminal", "c_res", "d_malintent"]:
    ARMS[arm] = {
        "npz": os.path.join(REPO, "experiment", "runs", "v24_arms", arm, "run", "seed42_main", "checkpoint.npz"),
        "cfg": dm.load_config(os.path.join(REPO, "experiment", "runs", "v24_arms", arm, "config.yaml")),
    }


def cfg_json(env_cfg):
    """yaml env 节 → TS EnvConfig 字段（camelCase，一一对应；meta.cfg 供回放端自建配置）。"""
    return {
        "nAgents": int(env_cfg["n_agents"]), "world": float(env_cfg["world"]),
        "detectRadius": float(env_cfg["detect_radius"]), "tMax": int(env_cfg["t_max"]),
        "pDetectBase": float(env_cfg["p_detect_base"]), "stealthMult": float(env_cfg["stealth_mult"]),
        "pDetectMax": float(env_cfg["p_detect_max"]), "pExplosion": float(env_cfg["p_explosion"]),
        "developRate": float(env_cfg["develop_rate"]), "techCap": float(env_cfg["tech_cap"]),
        "techSpawnLo": float(env_cfg["tech_spawn_lo"]), "techSpawnHi": float(env_cfg["tech_spawn_hi"]),
        "killBase": float(env_cfg["kill_base"]), "killTechSlope": float(env_cfg["kill_tech_slope"]),
        "resMin": float(env_cfg["res_min"]), "resMax": float(env_cfg["res_max"]),
        "pDeplete": float(env_cfg["p_deplete"]), "depleteLo": float(env_cfg["deplete_lo"]),
        "depleteHi": float(env_cfg["deplete_hi"]),
        "gateBroadcastTech": float(env_cfg["gate_broadcast_tech"]),
        "gateBroadcastRes": float(env_cfg["gate_broadcast_res"]),
        "gateObserveTech": float(env_cfg["gate_observe_tech"]),
        "gateDomainTech": float(env_cfg["gate_domain_tech"]),
        "gateStrikeTech": float(env_cfg["gate_strike_tech"]),
        "developReward": float(env_cfg["develop_reward"]), "deathPenalty": float(env_cfg["death_penalty"]),
        "bdEntryPenalty": float(env_cfg["bd_entry_penalty"]),
        "bdGrowthMult": float(env_cfg["bd_growth_mult"]), "bdExplosionMult": float(env_cfg["bd_explosion_mult"]),
        "enableBlackDomain": bool(env_cfg["enable_black_domain"]),
        "spawnSchedule": [[int(t), int(c)] for t, c in env_cfg.get("spawn_schedule", [[0, 12]])],
        "resTotalBudget": float(env_cfg.get("res_total_budget", 150.0)),
        "shieldCostFrac": float(env_cfg.get("shield_cost_frac", 0.5)),
        "softsignA": float(env_cfg.get("softsign_a", 0.2)),
        "softsignRewardScale": float(env_cfg.get("softsign_reward_scale", 1.0)),
        "resRewardScale": float(env_cfg.get("res_reward_scale", 0.0)),
        "attackReward": float(env_cfg.get("attack_reward", 0.0)),
    }


def _enc(v):
    if isinstance(v, np.ndarray):
        tag = "b64:f32" if v.dtype == np.float32 else "b64:f64"
        return tag + ":" + base64.b64encode(np.ascontiguousarray(v).tobytes()).decode()
    return float(v)


def _sz(size):
    if size is None:
        return None
    return list(size) if isinstance(size, tuple) else int(size)


class RecordingRng:
    """包装 numpy Generator——env2_v24.py 只调 uniform(...) / choice(a)。"""

    def __init__(self, inner):
        self.inner = inner
        self.log = []

    def uniform(self, low=0.0, high=1.0, size=None):
        v = self.inner.uniform(low, high, size=size)
        self.log.append({"m": "uniform", "args": [float(low), float(high), _sz(size)], "v": _enc(v)})
        return v

    def choice(self, a):
        v = self.inner.choice(a)
        self.log.append({"m": "choice", "args": [[int(x) for x in a]], "v": int(v)})
        return v


def apply_patch(env, patch):
    """reset 后的声明式补丁（TS 端 applyPatch 执行同一份）。"""
    for i, j in patch.get("known", []):
        env.known[int(i), int(j)] = True
    for i, v in patch.get("tech", []):
        env.tech[int(i)] = float(v)
    for i, v in patch.get("res", []):
        env.res[int(i)] = float(v)
    for x in patch.get("pos", []):
        env.pos[int(x[0])] = [float(x[1]), float(x[2])]
    for i, v in patch.get("alive", []):
        env.alive[int(i)] = bool(v)
    if "free_pool" in patch:
        env.free_pool = float(patch["free_pool"])
    if "pending_spawns" in patch:
        env.pending_spawns = [float(x) for x in patch["pending_spawns"]]


def snapshot(env):
    """与 TS EnvSnapshot 同形：矩阵/坐标一律平铺（known=36*36、pos=36*2）。"""
    return {
        "t": env.t,
        "pos": env.pos.reshape(-1).tolist(),
        "tech": env.tech.tolist(),
        "res": env.res.tolist(),
        "alive": env.alive.astype(int).tolist(),
        "known": env.known.astype(int).reshape(-1).tolist(),
        "observed": env.observed.astype(int).reshape(-1).tolist(),
        "public": env.public.astype(int).tolist(),
        "in_domain": env.in_domain.astype(int).tolist(),
        "domain_windup": env.domain_windup.astype(int).tolist(),
        "pending_reveal": [list(x) for x in env.pending_reveal],
        "pending_counter": list(env.pending_counter),
        "last_action": env.last_action.tolist(),
        "first_detect_tick": env.first_detect_tick.reshape(-1).tolist(),
        "free_pool": env.free_pool,
        "pending_spawns": list(env.pending_spawns),
        "birth_log": [list(x) for x in env.birth_log],
        "death_cause": list(env.death_cause),
        "spawn_tick": env.spawn_tick.tolist(),
        "spawn_tech": env.spawn_tech.tolist(),
        "spawn_res": env.spawn_res.tolist(),
        "peak_tech": env.peak_tech.tolist(),
        "spawn_total_res": float(env.res.sum() + env.free_pool),
    }


def _jsonable_info(info):
    return {
        "detections": [[int(i), int(j)] for i, j in info["detections"]],
        "strikes": [[int(i), int(j), bool(k)] for i, j, k in info["strikes"]],
        "invasions": [[int(i), int(j), bool(k)] for i, j, k in info["invasions"]],
        "loot_to": info["loot_to"].tolist(),
        "died_this_tick": [[int(v), str(c)] for v, c in info["died_this_tick"]],
        "strikes_blocked": [[int(i), int(j), float(t)] for i, j, t in info["strikes_blocked"]],
        "strike_events": [
            [int(i), int(j), str(o), float(ti), float(tj), float(t)]
            for i, j, o, ti, tj, t in info["strike_events"]
        ],
        "free_pool": float(info["free_pool"]),
        "res_conservation_residual": float(info["res_conservation_residual"]),
        "n_births": int(info["n_births"]),
        "n_alive": int(info["n_alive"]),
        "in_domain": int(info["in_domain"]),
        "counter_detections": int(info["counter_detections"]),
    }


def load_agent(arm, seed=1001):
    cfg = ARMS[arm]["cfg"]
    tc = cfg["train"]
    agent = DQNAgent(
        obs_dim=dm.OBS_DIM, n_actions=dm.N_ACTIONS, hidden=[int(h) for h in cfg["model"]["hidden"]],
        lr=float(tc["lr"]), gamma=float(tc["gamma"]), batch_size=int(tc["batch_size"]),
        replay_size=int(tc["replay_size"]), target_sync=int(tc["target_sync"]), seed=seed,
    )
    agent.load(ARMS[arm]["npz"])
    return agent


def run_trace(seed, kinds, agent_arms=None, script=None, patch=None, max_ticks=None, note="", cfg=None):
    """script(env, t) -> (actions, targets, forced_re | None)；agent_arms: {slot: arm 名}。

    cfg：本轨迹的完整 config（ learner 轨迹=对应臂训练 config；默认=config_v24）。"""
    cfg = cfg if cfg is not None else CFG
    env = dm.make_env(cfg, seed=seed)
    env.rng = RecordingRng(np.random.default_rng(seed))
    run_rng = np.random.default_rng(seed * 7 + 13)  # 预制决策/均匀目标（stage_b 单流口径）
    agents = {a: load_agent(a) for a in sorted(set(agent_arms.values()))} if agent_arms else {}
    obs, valid = env.reset()
    if patch:
        apply_patch(env, patch)
        obs, valid = env._obs(), env._valid()  # 补丁后重算（回放端同序）
    trace = {
        "meta": {"seed": seed, "kinds": list(kinds), "agentArms": agent_arms or {},
                 "driver": "scripted" if script else "stage_b", "note": note,
                 "cfg": cfg_json(cfg["env"])},
        "reset": {"patch": patch, "state": snapshot(env), "obs": _enc(obs)},
        "ticks": [],
        "rngLog": env.rng.log,
    }
    done, t = False, 0
    while not done and (max_ticks is None or t < max_ticks):
        targets = np.full(env.n, -1, dtype=np.int64)
        forced_re = None
        if script:
            actions, targets, forced_re = script(env, t)
        else:
            actions = np.zeros(env.n, dtype=np.int64)
            for i in range(env.n):
                if env.alive[i] and kinds[i] != "learner":
                    actions[i] = heuristic_action(kinds[i], obs, valid, env, i, run_rng, env.t)
            by_arm = {}
            for i in range(env.n):
                if env.alive[i] and kinds[i] == "learner":
                    by_arm.setdefault(agent_arms[i], []).append(i)
            for arm in sorted(by_arm):
                li = np.array(by_arm[arm])
                actions[li] = agents[arm].act(obs[li], valid[li], 0.05)
            tmask = env.select_targets(actions)
            for i in np.where(np.isin(actions, TARGET_ACTIONS))[0]:
                cand = np.where(tmask[i])[0]
                if cand.size:
                    if kinds[i] == "df":
                        targets[i] = pick_target(tmask[i], "df", env.tech, actions[i])
                    else:
                        targets[i] = int(run_rng.choice(cand))  # learner/random 均匀（stage_b_v24.py:52）
        invaded = env.begin_tick(actions, targets)
        re_obs = env._obs() if invaded else None
        re = actions.copy()
        if forced_re:
            for v, a in forced_re.items():
                re[v] = a
        elif invaded:
            re_valid = env._valid()
            for v in invaded:
                if kinds[v] == "learner":
                    re[v] = agents[agent_arms[v]].act(re_obs[v:v + 1], re_valid[v:v + 1], 0.05)[0]
                else:
                    re[v] = heuristic_action(kinds[v], re_obs, re_valid, env, v, run_rng, env.t)
        nobs, _nvalid, r, alive, done, info, dead = env.resolve(re)
        trace["ticks"].append({
            "actions": actions.tolist(), "targets": targets.tolist(),
            "invaded": [int(x) for x in invaded],
            "reObs": _enc(re_obs) if re_obs is not None else None,
            "reActions": re.tolist(),
            "post": {"state": snapshot(env), "obs": _enc(nobs),
                     "info": _jsonable_info(info), "rewards": r.tolist(), "done": bool(done)},
        })
        obs, valid = nobs, env._valid()
        t += 1
    return trace


def write_trace(name, trace):
    path = os.path.join(OUT, f"{name}.json.gz")
    with open(path, "wb") as f:
        f.write(gzip.compress(json.dumps(trace, separators=(",", ":")).encode()))
    print(f"{name}: {len(trace['ticks'])} ticks, {len(trace['rngLog'])} draws, "
          f"{os.path.getsize(path)} bytes gz")


def main():
    os.makedirs(OUT, exist_ok=True)
    n = CFG["env"]["n_agents"]
    t_max = CFG["env"]["t_max"]

    # ---- 完整对局 1：stage_b 池型（learner=a_classic + random/df/pacifist 各 9）----
    kinds = build_pattern(n)
    arms = {i: "a_classic" for i in range(n) if kinds[i] == "learner"}
    write_trace("trace-main-s1", run_trace(
        41001, kinds, arms, note="stage_b pool, a_classic ckpt", cfg=ARMS["a_classic"]["cfg"]))

    # ---- 完整对局 2：全 pacifist（无 DQN；发展/爆炸/出生/饿死长尾）----
    write_trace("trace-main-s2", run_trace(41002, ["pacifist"] * n, None, note="pacifist only"))

    # ---- 完整对局 3：d_malintent 池 + 该臂奖励参数（揭露/赏金/资源津贴路径）----
    arms_d = {i: "d_malintent" for i in range(n) if kinds[i] == "learner"}
    write_trace("trace-main-d", run_trace(
        41007, kinds, arms_d, note="stage_b pool, d_malintent ckpt + arm rewards",
        cfg=ARMS["d_malintent"]["cfg"]))

    # ---- 定向：互毁 ----
    def scripted_mutual(env, t):
        actions = np.zeros(env.n, dtype=np.int64)
        targets = np.full(env.n, -1, dtype=np.int64)
        if t == 0:
            actions[0] = A_INVADE
            targets[0] = 1
            return actions, targets, {1: A_INVADE}  # 受害者反咬（无目标亦生效，Q9）
        return actions, targets, None

    write_trace("trace-tgt-mutual", run_trace(
        41003, ["pacifist"] * n, None, script=scripted_mutual,
        patch={"known": [[0, 1]], "tech": [[0, 6], [1, 6]]}, max_ticks=6, note="mutual destruction"))

    # ---- 定向：护盾 ----
    def scripted_shield(env, t):
        actions = np.zeros(env.n, dtype=np.int64)
        targets = np.full(env.n, -1, dtype=np.int64)
        if t < 3:
            actions[0] = A_STRIKE
            targets[0] = 1
        return actions, targets, None

    write_trace("trace-tgt-shield", run_trace(
        41004, ["pacifist"] * n, None, script=scripted_shield,
        patch={"known": [[0, 1]], "tech": [[0, 8], [1, 20]]}, max_ticks=4, note="shield block"))

    # ---- 定向：黑域风窗免疫 ----
    def scripted_windup(env, t):
        actions = np.zeros(env.n, dtype=np.int64)
        targets = np.full(env.n, -1, dtype=np.int64)
        if t == 0:
            actions[0] = 5   # 0 声明黑域 → 风窗
            actions[2] = A_STRIKE
            targets[2] = 0    # 2 打击风窗中的 0 → 免疫
        if t == 1:
            actions[2] = A_INVADE
            targets[2] = 0    # 0 已在域 → 入侵取消
        return actions, targets, None

    write_trace("trace-tgt-windup", run_trace(
        41005, ["pacifist"] * n, None, script=scripted_windup,
        patch={"known": [[0, 1], [2, 0]], "tech": [[0, 6], [1, 6], [2, 9]]},
        max_ticks=6, note="domain windup immunity"))

    # ---- 定向：资源枯竭 → 热寂/晚局 ----
    write_trace("trace-tgt-heat", run_trace(
        41006, ["pacifist"] * n, None,
        patch={"res": [[0, 1.0], [1, 1.0], [2, 1.0], [3, 1.0]], "free_pool": 146.0},
        note="starvation cascade toward heat death"))

    # ---- stats.json：统计等价第二口径（30 局 presets-only）----
    stats_eps = []
    for ep in range(30):
        seed = 51001 + ep
        env = dm.make_env(CFG, seed=seed)
        rng = np.random.default_rng(seed * 7 + 13)
        kinds = (["random", "df", "pacifist"] * (n // 3 + 1))[:n]
        obs, valid = env.reset()
        alive_ticks = np.zeros(n)
        act_counts = np.zeros(dm.N_ACTIONS)
        kills = 0
        done = False
        while not done:
            actions = np.zeros(env.n, dtype=np.int64)
            for i in range(env.n):
                if env.alive[i]:
                    actions[i] = heuristic_action(kinds[i], obs, valid, env, i, rng, env.t)
            tmask = env.select_targets(actions)
            targets = np.full(env.n, -1, dtype=np.int64)
            for i in np.where(np.isin(actions, TARGET_ACTIONS))[0]:
                cand = np.where(tmask[i])[0]
                if cand.size:
                    targets[i] = (pick_target(tmask[i], "df", env.tech, actions[i])
                                  if kinds[i] == "df" else int(rng.choice(cand)))
            invaded = env.begin_tick(actions, targets)
            re = actions.copy()
            for v in invaded:
                re[v] = heuristic_action(kinds[v], obs, env._valid(), env, v, rng, env.t)
            obs, valid, _r, alive, done, info, _d = env.resolve(re)
            alive_ticks += env.alive
            act_counts += np.bincount(re[env.alive.astype(bool)], minlength=dm.N_ACTIONS)
            kills += sum(1 for _i, _j, k in info["strikes"] if k)
        stats_eps.append({
            "aliveFrac": float(alive_ticks.sum() / (n * t_max)),
            "actionFreqs": (act_counts / max(1, act_counts.sum())).tolist(),
            "kills": int(kills),
        })
    stats = {
        "episodes": len(stats_eps),
        "seedsBase": 51001,
        "kindsPattern": ["random", "df", "pacifist"],
        "meanAliveFrac": float(np.mean([e["aliveFrac"] for e in stats_eps])),
        "meanKills": float(np.mean([e["kills"] for e in stats_eps])),
        "actionFreqs": np.mean([e["actionFreqs"] for e in stats_eps], axis=0).tolist(),
    }
    with open(os.path.join(OUT, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1)
    print(f"stats: {stats['meanAliveFrac']:.4f} aliveFrac, {stats['meanKills']:.2f} kills, "
          f"{stats['episodes']} episodes")


if __name__ == "__main__":
    main()
