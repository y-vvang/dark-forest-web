#!/usr/bin/env python3
"""npz → public/models/<id>.json（开发期专用；v2.5 四奖励臂 + v3.0 champion）。

npz = 无压缩 ZIP 内嵌 .npy v1.0（LE float64, C 序）；Python json.dumps 的 float repr
与 JS JSON.parse 对 float64 逐位往返（IEEE 保证），零精度损失。
正定性由 dqn-parity 测试逐模型比对 numpy 前向输出兜底（opponents/dqn.test.ts）。
"""
import json
import os

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = {
    arm: os.path.join(REPO, "experiment", "runs", "v25_arms", arm, "run", "seed42_main", "checkpoint.npz")
    for arm in ["a_classic", "b_terminal", "c_res", "d_malintent"]
}
# v3.0 champion（league 1000ep，seed 42）——"见过所有策略家族的泛化体"
MODELS["champion"] = os.path.join(
    REPO, "experiment", "runs", "v3", "v30_champion", "run", "seed42_champion", "checkpoint.npz")

OUT = os.path.join(REPO, "public", "models")
os.makedirs(OUT, exist_ok=True)

for arm, path in MODELS.items():
    d = np.load(path, allow_pickle=False)
    w = {
        "arm": arm,
        "source": os.path.relpath(path, REPO).replace("\\", "/"),
        "updates": int(d["updates"]),
        "shapes": {"W0": [38, 64], "b0": [64], "W1": [64, 64], "b1": [64], "W2": [64, 8], "b2": [8]},
    }
    for k in ["W0", "b0", "W1", "b1", "W2", "b2"]:
        arr = d[f"online__{k}"]
        assert tuple(arr.shape) == tuple(w["shapes"][k]), (arm, k, arr.shape)
        w[k] = arr.tolist()
    with open(os.path.join(OUT, f"{arm}.json"), "w") as f:
        json.dump(w, f, separators=(",", ":"))
    print(f"{arm}: updates={w['updates']} {os.path.getsize(os.path.join(OUT, f'{arm}.json'))} bytes")
print("done:", len(MODELS), "models ->", OUT)
