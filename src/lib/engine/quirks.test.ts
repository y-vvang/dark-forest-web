/**
 * Q1–Q13 综合锁定（docs/env-model-v23.md §0）。
 * 各 quirk 的行为开发已在所属阶段先行 TDD（Q1=reset、Q4/9/12=resolve-b、
 * Q5/6=resolve-c、Q3=obs）；本文件补齐未单独覆盖者并交叉引用。
 * v2.4 新增 Q13：BOTHER 揭露的归因歧义（对被揭露者不可见）→ resolve-b.test。
 */
import { expect, test } from "bun:test";

import { makeEnv, tick } from "./test-helpers";

// Q1 站位拒绝采样读取旧位置 → reset.test.ts（"consecutive resets"用例，抽取计数 962 锁定）
// Q4 风窗免疫入侵（重选 BD 取消）→ resolve-b.test.ts（"victim re-choosing BD"）
// Q5 残差是 info 字段而非 assert → resolve-c.test（守恒）；下面补"非零仅上报不抛错"
test("Q5: residual is a reported field, not an assert (env2_v24.py:649)", () => {
    const env = makeEnv();
    env.reset();
    env.res[0] += 5; // 人为制造 5 的缺口
    const { result } = tick(env, new Int32Array(36));
    expect(result.info.res_conservation_residual).toBeCloseTo(-5, 10); // 如实上报
    // 且结算正常完成、未抛错
});

// Q6 develop_reward 未被使用 → resolve-c.test（奖励走 softsign）；下面证 0 尺度即 0 奖励
test("Q6: develop_reward unused — zero softsign scale zeroes the reward (config_v24 developReward=0.05 仍存在)", () => {
    const env = makeEnv([], 0.5, { softsignRewardScale: 0, resRewardScale: 0.0025 });
    env.reset();
    env.tech[0] = 6;
    const actions = new Int32Array(36).fill(1);
    const { result } = tick(env, actions);
    expect(result.rewards[0]).toBeCloseTo(0.0025 * 10, 12); // 仅 res 津贴；若误用 develop_reward(0.05) 则非此值
});

test("Q2: broadcaster self-knowledge enters its own known-alive obs count (env2_v24.py:435-437 + obs scalar 2)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6;
    const actions = new Int32Array(36);
    actions[0] = 2; // BROADCAST_ALL
    tick(env, actions); // 入队
    tick(env, new Int32Array(36)); // 结算 → known[0,0]=1
    expect(env.known[0 * 36 + 0]).toBe(1);
    const r0 = env.obs().slice(0 * 36, 1 * 36);
    expect(r0[2]).toBe(Math.fround(1 / 35)); // 自知计入已知存活数
});

test("Q3+Q4: strike at a windup target produces no event (anyKnown survives sanitize, matrix filters it)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.tech[0] = 9;
    env.known[0 * 36 + 1] = 1;
    env.domain_windup[1] = 1; // 唯一已知目标在风窗
    const actions = new Int32Array(36);
    actions[0] = 4;
    const { result } = tick(env, actions); // eff 保留 STRIKE（known & alive 为真），矩阵全 inf → 跳过
    expect(result.info.strike_events).toEqual([]);
    expect(result.info.strikes).toEqual([]);
    expect(env.alive[1]).toBe(1);
});

test("Q3: domain target keeps geometry in near blocks, intel masked, feature stays 0", () => {
    const env = makeEnv();
    env.reset();
    env.pos[1 * 2] = 10;
    env.pos[2 * 2] = 20;
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1;
    env.in_domain[1] = 1;
    const r0 = env.obs().slice(0, 36);
    expect(r0[15]).toBe(Math.fround((10 - 0.02) / 50)); // k=0 = 域内 slot1——几何保留（feature-major）
    expect(r0[24]).toBe(-1); // 情报掩蔽
    expect(r0[33]).toBe(0); // in_domain 特征恒 0（Q3）
});

test("Q7: exists getter mirrors env2_v24.py:244-247 (spawn_tick-gated, unused by resolve)", () => {
    const env = makeEnv();
    env.reset();
    expect([...env.exists].filter(Boolean)).toHaveLength(4); // 初始 4 席
    tick(env, new Int32Array(36)); // slot 4 出生（spawn_tick=1 = 新 t）
    expect(env.exists[4]).toBe(1);
    expect(env.exists[5]).toBe(0); // 未生
    env.alive[4] = 0;
    expect(env.exists[4]).toBe(0); // 死者恒 false
});

// Q9 反咬无需有效目标 → resolve-b.test（"counter-invade needs no valid target"）
// Q11 一次性槽位 → resolve-c.test（"Q11: one-shot slots"）
// Q12 护盾不耗 RNG → resolve-b.test（"shield block: no RNG consumed"）
