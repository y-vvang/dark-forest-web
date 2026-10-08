#!/usr/bin/env python3
"""录制 DQN 前向奇偶数据（开发期专用）：12 模型 × 10 随机输入 → numpy 输出。

TS 端 dqn-parity 测试（src/lib/opponents/dqn.test.ts）逐模型比对，|ΔQ|≤1e-9。
容差论证：numpy BLAS 分块求和序与 TS 朴素循环不可逐位一致（~1e-15 相对）；任何
转换错误（键错/序错/精度截断）的偏差 ≥1e-6 量级，1e-9 足以锁死转换完整性。
"""
import json
import os

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys_path = os.path.join(REPO, "experiment", "experiment")
import sys  # noqa: E402

sys.path.insert(0, sys_path)
import data2 as dm  # noqa: E402
from model import DQNAgent  # noqa: E402

ARMS = {
    "main": os.path.join(REPO, "experiment", "runs", "v23_fix", "seed42_main", "checkpoint.npz"),
}
for arm in ["base_control", "budget100", "budget200", "gamma099", "gamma0999", "lr3e4",
            "lr12e3", "scale005", "scale02", "shield025", "shield075"]:
    ARMS[arm] = os.path.join(
        REPO, "experiment", "runs", "v23_fix_sweep_arms", arm, "run", "seed42_main", "checkpoint.npz")

OUT = os.path.join(REPO, "src", "lib", "engine", "testdata", "dqn-outputs.json")
rng = np.random.default_rng(777)
inputs = rng.uniform(-1, 1, size=(10, 38)).astype(np.float32)

arms_out = []
for arm, path in ARMS.items():
    agent = DQNAgent(obs_dim=dm.OBS_DIM, n_actions=dm.N_ACTIONS, hidden=[64, 64],
                     lr=6e-4, gamma=0.995, batch_size=128, replay_size=150000,
                     target_sync=2000, seed=1001)
    agent.load(path)
    q, _ = agent.online.forward(inputs.astype(np.float64))
    arms_out.append({"arm": arm, "inputs": inputs.tolist(), "outputs": q.tolist()})
    print(f"{arm}: q[0][:3] = {q[0][:3]}")

with open(OUT, "w") as f:
    json.dump({"arms": arms_out}, f, separators=(",", ":"))
print("done ->", OUT)
