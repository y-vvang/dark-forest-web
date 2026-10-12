import { expect, test } from "bun:test";

import { assertConservation } from "./snapshot";
import { makeEnv, tick } from "./test-helpers";

test("develop: growth 0.05*(1-tech/1e6), softsign reward 0.01*tech/(1+0.2|tech|) (env2_v24.py:574-629)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6;
    const actions = new Int32Array(36).fill(1); // 全员 DEVELOP
    const { result } = tick(env, actions);
    const tech1 = 6 + 0.05 * (1 - 6 / 1e6);
    expect(env.tech[0]).toBeCloseTo(tech1, 12);
    expect(result.rewards[0]).toBeCloseTo((0.01 * tech1) / (1 + 0.2 * Math.abs(tech1)), 12);
    expect(result.rewardDetail.techTerm[0]).toBeCloseTo(tech1 / (1 + 0.2 * Math.abs(tech1)), 12);
    expect(result.rewardDetail.resAtReward[0]).toBeCloseTo(10, 12); // res 无流失
});

test("res_reward_scale stipend on DEVELOP ticks only (v2.4 c/d 臂公式，smoke_v24 口径)", () => {
    const env = makeEnv([], 0.5, { resRewardScale: 0.0025 });
    env.reset();
    env.tech[0] = 6;
    const actions = new Int32Array(36);
    actions[0] = 1; // 仅 0 号 DEVELOP；1 号 SILENT（无津贴）
    const { result } = tick(env, actions);
    const tech1 = 6 + 0.05 * (1 - 6 / 1e6);
    expect(result.rewards[0]).toBeCloseTo((0.01 * tech1) / (1 + 0.2 * tech1) + 0.0025 * 10, 12);
    expect(result.rewards[1]).toBe(0);
    // techTerm/resAtReward 允许任意参数集重算：四臂 d 组合 = soft 0.01 + res 0.0025
    const d =
        0.01 * result.rewardDetail.techTerm[0] + 0.0025 * result.rewardDetail.resAtReward[0];
    expect(result.rewards[0]).toBeCloseTo(d, 15);
});

test("develop inside domain ×0.2 (env2.py:564)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6;
    env.in_domain[0] = 1;
    const actions = new Int32Array(36);
    actions[0] = 1;
    tick(env, actions);
    expect(env.tech[0]).toBeCloseTo(6 + 0.05 * (1 - 6 / 1e6) * 0.2, 12);
});

test("explosion: p=0.01, tech *= U[1.6,2.2] (env2.py:567-571)", () => {
    // 队列对齐：探测 1296×0.5（无火）→ boom 阵列 36 值（slot0=0.005 命中，余 0.5）
    // → 倍率脚本值 1.9（ScriptedRng 原样返回）
    const env = makeEnv([...Array(1296).fill(0.5), 0.005, ...Array(35).fill(0.5), 1.9], 0.5);
    env.reset();
    env.tech[0] = 10;
    tick(env, new Int32Array(36));
    expect(env.tech[0]).toBeCloseTo(19, 10); // 10 × 1.9
});

test("depletion → starvation → corpse settlement (env2.py:573-592)", () => {
    // 队列：探测 1296×0.5 → boom 36×0.5 → 流失阵 u=0.01（命中 slot0）→ loss 脚本值 0.5
    const env = makeEnv([...Array(1296 + 36).fill(0.5), 0.01, 0.5], 0.5);
    env.reset();
    env.pending_spawns[0] = 9999; // 抑制同刻出生
    env.res[0] = 0.3;
    env.free_pool += 9.7; // 篡改守恒补偿（10 → 0.3）
    const { result } = tick(env, new Int32Array(36));
    expect(env.alive[0]).toBe(0);
    expect(env.death_cause[0]).toBe("starve");
    expect(result.rewards[0]).toBe(-10); // 死亡惩罚；发展奖励被排除（dev_alive 只含活者）
    expect(env.res[0]).toBe(0);
    expect(env.free_pool).toBeCloseTo(120, 10); // 110 + 9.7 + 0.3(流失入池)
    expect(result.info.died_this_tick).toEqual([[0, "starve"]]);
    assertConservation(env);
});

test("observe: intel on nearest known + counter-exposure next tick (env2.py:549-556)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999; // 抑制出生——出生会扩候选集 [1,2,3]→[1,2,3,4]
    env.tech[0] = 6; // >5
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 7; // OBSERVE
    tick(env, actions);
    expect(env.observed[0 * 36 + 1]).toBe(1);
    expect(env.pending_counter).toEqual([0]);
    // 下一刻：反曝光——choice fill=0.5 → cand [1,2,3] 索引 1 → slot 2 发现观测者
    const r2 = tick(env, new Int32Array(36));
    expect(env.known[2 * 36 + 0]).toBe(1);
    expect(r2.result.info.counter_detections).toBe(1);
});

test("observe with only a domain-known target: no intel, no exposure (stale matrix path)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    env.in_domain[1] = 1; // 唯一已知者在域——anyKnown 为真，eff 保留 OBSERVE，但目标全 inf
    const actions = new Int32Array(36);
    actions[0] = 7;
    tick(env, actions);
    expect(env.observed[0 * 36 + 1]).toBe(0);
    expect(env.pending_counter).toEqual([]); // 无目标 → 不曝光
});

test("birth: pool-afforded endogenous spawn, NO tech inheritance (env2_v24.py:249-275)", () => {
    // 队列对齐：探测 1296 + boom 36 + 流失 36（全 0.5 无事件）→ 新预滚 12.5（v2.4 出生
    // 不再抽取科技——每出生少 1 个 RNG 值，此处脚本恰一个尾值）
    const env = makeEnv([...Array(1296 + 36 + 36).fill(0.5), 12.5], 0.5);
    env.reset(); // pool=110，预滚 12.5
    const { result } = tick(env, new Int32Array(36));
    expect(env.tech[4]).toBe(1.0); // v2.4 无继承：出生科技恒 tech_spawn_lo
    expect(env.res[4]).toBe(12.5);
    expect(env.spawn_tech[4]).toBe(1.0);
    expect(env.spawn_tick[4]).toBe(1);
    expect(env.alive[4]).toBe(1);
    expect(env.birth_log).toEqual([[1, 4, 12.5]]);
    expect(env.free_pool).toBeCloseTo(110 - 12.5, 10);
    expect(result.info.n_births).toBe(1);
    expect(result.info.n_alive).toBe(5);
    expect(env.pending_spawns.length).toBe(1); // 新预滚（脚本值 12.5）
    expect(env.pending_spawns[0]).toBe(12.5);
    // 出生恰好消耗 1 个 RNG 值（再预滚）——科技抽取已删
    expect((env.rng as import("./rng").ScriptedRng).consumed).toBe(81 + 1296 + 36 + 36 + 1);
    assertConservation(env);
});

test("Q11: one-shot slots — dead slot never reused (env2.py:233)", () => {
    const env = makeEnv();
    env.reset();
    tick(env, new Int32Array(36)); // t 0→1：slot 4 出生
    expect(env.alive[4]).toBe(1);
    // slot 0 打死 slot 4（p=0.95 > 0.5）；尸体 12.5 同刻入池 → 池 110 ≥ 预滚
    // → 同刻内生出生取 slot 5（阶段 10 晚于 8b），绝不复用 4
    env.tech[0] = 9;
    env.known[0 * 36 + 4] = 1;
    const actions = new Int32Array(36);
    actions[0] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 4;
    tick(env, actions, targets); // t 1→2
    expect(env.alive[4]).toBe(0);
    expect(env.alive[5]).toBe(1);
    expect(env.spawn_tick[5]).toBe(2);
    expect(env.birth_log.length).toBe(2);
});

test("done: t>=tMax; heat death; resolve after done throws (env2.py:614-615)", () => {
    const env = makeEnv();
    env.reset();
    env.t = 249;
    const { result } = tick(env, new Int32Array(36));
    expect(result.done).toBe(true);
    expect(() => env.resolve(new Int32Array(36))).toThrow(/done/);
    const env2_ = makeEnv();
    env2_.reset();
    env2_.alive.fill(0); // 测试篡改（不走结算，不验守恒）
    env2_.pending_spawns[0] = 9999; // 池 < 预滚 → 热寂
    const r2 = tick(env2_, new Int32Array(36));
    expect(r2.result.done).toBe(true);
});
