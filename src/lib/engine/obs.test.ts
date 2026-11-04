import { expect, test } from "bun:test";

import { numpyArgsort } from "./numpy-sort";
import { makeEnv } from "./test-helpers";
import { OBS_DIM } from "./types";

const LOG_REF = Math.log1p(50);
/**
 * 每行 38 = 9 标量 + 8 one-hot + 近邻块（feature-major，env2_v25.py:416-431 的
 * np.concatenate(axis=-1) 拼各 (n,NEAR_K) 列组）：
 * [17+k]=Δx [20+k]=Δy [23+k]=d [26+k]=tech [29+k]=res [32+k]=public [35+k]=in_domain
 * v2.5：[7]=under_attack、[8]=self_public；[2]/[3] 除以固定 n_norm=36 并 clip[0,2]。
 */
function row(env: ReturnType<typeof makeEnv>, i: number) {
    return env.obs().slice(i * OBS_DIM, (i + 1) * OBS_DIM);
}

test("obs layout: scalars + onehot(8) + masked near blocks (feature-major)", () => {
    const env = makeEnv();
    env.reset(); // techs [1,2,3,4]，res 全 10，全坐标 (0.02,0.02)，无已知
    const r0 = row(env, 0);
    expect(r0[0]).toBe(Math.fround(Math.log1p(1) / LOG_REF));
    expect(r0[1]).toBe(Math.fround(10 / 20));
    expect(r0[2]).toBe(Math.fround(0 / 36)); // 无已知（n_norm 分母）
    expect(r0[3]).toBe(Math.fround(4 / 36));
    expect(r0[4]).toBe(Math.fround(0 / 250));
    expect(r0[5]).toBe(0);
    expect(r0[6]).toBe(0);
    expect(r0[7]).toBe(0); // v2.5 under_attack
    expect(r0[8]).toBe(0); // v2.5 self_public
    expect(r0[9]).toBe(1); // last_action = SILENT one-hot（base+9）
    expect(r0.slice(10, 17).every((v) => v === 0)).toBe(true);
    // 无已知 → 三近邻全掩蔽：Δx/Δy/d 全 0，tech 全 -1，res 全 -0.05，public/in_domain 全 0
    expect(r0[17]).toBe(0);
    expect(r0[18]).toBe(0);
    expect(r0[19]).toBe(0);
    expect(r0[20]).toBe(0);
    expect(r0[23]).toBe(0);
    expect(r0[26]).toBe(-1);
    expect(r0[27]).toBe(-1);
    expect(r0[28]).toBe(-1);
    expect(r0[29]).toBe(Math.fround(-1 / 20));
    expect(r0[30]).toBe(Math.fround(-1 / 20));
    expect(r0[31]).toBe(Math.fround(-1 / 20));
    expect(r0[32]).toBe(0);
    expect(r0[35]).toBe(0); // Q3：in_domain 特征恒 0
});

test("observed intel fills tech/res; torus wrap delta (env2_v25.py:411-413)", () => {
    const env = makeEnv();
    env.reset();
    env.pos[2 * 2] = 98; // slot 2 x=98；自身 x=0.02 → 环面 Δ = 98-0.02-100 = -2.02
    env.known[0 * 36 + 2] = 1;
    env.observed[0 * 36 + 2] = 1;
    env.tech[2] = 7;
    env.res[2] = 14;
    const r0 = row(env, 0);
    expect(r0[2]).toBe(Math.fround(1 / 36)); // 已知存活计数（n_norm 分母）
    expect(r0[17]).toBe(Math.fround(-2.02 / 50)); // k=0（唯一候选）Δx 环面回绕
    expect(r0[18]).toBe(0); // k=1 掩蔽
    expect(r0[20]).toBe(0); // k=0 Δy（同 y）
    expect(r0[23]).toBe(Math.fround(2.02 / 50)); // k=0 d
    expect(r0[26]).toBe(Math.fround(Math.log1p(7) / LOG_REF)); // k=0 已观测 → 情报
    expect(r0[27]).toBe(-1); // k=1 掩蔽
    expect(r0[29]).toBe(Math.fround(14 / 20));
    expect(r0[32]).toBe(0);
    expect(r0[35]).toBe(0);
});

test("known-but-not-observed neighbor: position features, no intel (tech=-1)", () => {
    const env = makeEnv();
    env.reset();
    env.known[0 * 36 + 1] = 1; // 仅知存在与位置
    const r0 = row(env, 0);
    expect(r0[17]).toBe(Math.fround(0 / 50)); // 同点 → Δ=0
    expect(r0[23]).toBe(Math.fround(0 / 50));
    expect(r0[26]).toBe(-1); // 无 OBSERVE 情报
    expect(r0[29]).toBe(Math.fround(-1 / 20));
});

test("masked-row semantics: far known civ's flags enter masked slots (order from np.argsort, env2_v25.py:414-431)", () => {
    // 候选不足 3：掩码行 Δx/Δy/d=0、tech=-1、res=-0.05，但 public 取【排序后第 k 位】
    // 远方文明的旗标（known_pair 距离无关）——须与 numpy argsort 的 inf 平局序逐位一致。
    const env = makeEnv();
    env.reset();
    env.pos[5 * 2] = 80; // 5 号移远（>30）——known+alive+非域，但不在半径内
    env.known[0 * 36 + 5] = 1; // 0 号仅知 5 号（远处）
    env.public_[5] = 1; // 5 号已被揭露
    const r0 = row(env, 0);
    const big = new Float64Array(36).fill(Infinity); // 0 号 big 行全 inf（无候选）
    const order = numpyArgsort(big);
    for (const k of [0, 1, 2]) {
        expect(r0[32 + k]).toBe(order[k] === 5 ? 1 : 0); // public：旗标距离无关
        expect(r0[26 + k]).toBe(-1); // observed[0,5]=0 → 无情报
        expect(r0[29 + k]).toBe(Math.fround(-1 / 20));
        expect(r0[17 + k]).toBe(0); // Δx 掩码（dmask）
        expect(r0[23 + k]).toBe(0); // d 掩码
    }
});

test("domain target: real geometry, masked intel, in_domain feature 0 (env2_v25.py:411-413)", () => {
    const env = makeEnv();
    env.reset();
    env.pos[1 * 2] = 10; // slot1 距离 9.98
    env.pos[2 * 2] = 20; // slot2 距离 19.98
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1;
    env.in_domain[1] = 1; // 最近者入域——big 不滤域内者 → k=0 仍是 slot1（真实几何）
    const r0 = row(env, 0);
    expect(r0[17]).toBe(Math.fround((10 - 0.02) / 50)); // k=0 = slot1 的 Δx（几何保留）
    expect(r0[23]).toBe(Math.fround(9.98 / 50)); // k=0 的 d
    expect(r0[26]).toBe(-1); // k=0 tech 掩蔽（known_pair 含 ~in_domain）
    expect(r0[29]).toBe(Math.fround(-1 / 20));
    expect(r0[35]).toBe(0); // Q3：in_domain 特征恒 0
    expect(r0[18]).toBe(Math.fround((20 - 0.02) / 50)); // k=1 = slot2
    expect(r0[27]).toBe(-1);
    expect(row(env, 5).every((v) => v === 0)).toBe(true); // 未出生行
    env.alive[1] = 0;
    expect(row(env, 1).every((v) => v === 0)).toBe(true); // 死亡行
});

test("v2.5 scalars: under_attack / self_public enter obs (env2_v25.py:398-409)", () => {
    const env = makeEnv();
    env.reset();
    env.known[0 * 36 + 2] = 1;
    env.alive[0] = 1;
    env.under_attack[0] = 1;
    env.public_[0] = 1;
    const r0 = row(env, 0);
    expect(r0[7]).toBe(1); // under_attack
    expect(r0[8]).toBe(1); // self_public（自曝者同样可见）
    const r1 = row(env, 1);
    expect(r1[7]).toBe(0);
    expect(r1[8]).toBe(0);
    // n_norm 分母：已知含死者/未生但只计存活（4/36）；clip[0,2] 上限 2 = 72 个
    // 存活已知，n=36 世界不可达（仅 _grow 后 >72 并发存活才触及——由 grow 测试覆盖形状）
    const env2 = makeEnv();
    env2.reset();
    for (let j = 0; j < 36; j++) env2.known[0 * 36 + j] = 1;
    const r2 = row(env2, 0);
    expect(r2[2]).toBe(Math.fround(4 / 36)); // 仅存活 0-3 计入（含对角）
    expect(r2[3]).toBe(Math.fround(4 / 36)); // aliveCount 同分母
});
