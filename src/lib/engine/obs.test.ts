import { expect, test } from "bun:test";

import { makeEnv } from "./test-helpers";

const LOG_REF = Math.log1p(50);
/**
 * 每行 38 = 7 标量 + 10 one-hot + 近邻块（feature-major，env2.py:320-328 的
 * np.concatenate(axis=-1) 拼各 (n,NEAR_K) 列组）：
 * [17+k]=Δx [20+k]=Δy [23+k]=d [26+k]=tech [29+k]=res [32+k]=public [35+k]=in_domain
 */
function row(env: ReturnType<typeof makeEnv>, i: number) {
    return env.obs().slice(i * 38, (i + 1) * 38);
}

test("obs layout: scalars + onehot + masked near blocks (feature-major)", () => {
    const env = makeEnv();
    env.reset(); // techs [1,2,3,4]，res 全 10，全坐标 (0.02,0.02)，无已知
    const r0 = row(env, 0);
    expect(r0[0]).toBe(Math.fround(Math.log1p(1) / LOG_REF));
    expect(r0[1]).toBe(Math.fround(10 / 20));
    expect(r0[2]).toBe(Math.fround(0 / 35)); // 无已知
    expect(r0[3]).toBe(Math.fround(4 / 36));
    expect(r0[4]).toBe(Math.fround(0 / 250));
    expect(r0[5]).toBe(0);
    expect(r0[6]).toBe(0);
    expect(r0[7]).toBe(1); // last_action = SILENT one-hot
    expect(r0.slice(8, 17).every((v) => v === 0)).toBe(true);
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

test("observed intel fills tech/res; torus wrap delta (env2.py:311-318)", () => {
    const env = makeEnv();
    env.reset();
    env.pos[2 * 2] = 98; // slot 2 x=98；自身 x=0.02 → 环面 Δ = 98-0.02-100 = -2.02
    env.known[0 * 36 + 2] = 1;
    env.observed[0 * 36 + 2] = 1;
    env.tech[2] = 7;
    env.res[2] = 14;
    const r0 = row(env, 0);
    expect(r0[2]).toBe(Math.fround(1 / 35)); // 已知存活计数
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

test("domain target: real geometry, masked intel, in_domain feature 0 (env2.py:310-327)", () => {
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
