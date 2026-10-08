import { expect, test } from "bun:test";

import { V23_CONFIG } from "./config";
import { DarkForestEnv2 } from "./env";
import { ScriptedRng } from "./rng";
import { assertConservation } from "./snapshot";

/**
 * 队列：72 个 pos 值（0.02，全同点）→ 4 tech（1,2,3,4）→ 4 res（10）→ 1 预滚（12.5）。
 * ScriptedRng 原样返回——脚本的即终值。
 */
function makeEnv(queue: number[] = [], fill = 0.5, overrides = {}) {
    return new DarkForestEnv2(
        { ...V23_CONFIG, ...overrides },
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5, ...queue], fill),
    );
}

test("reset: initial cohort of 4, conservation, pending pre-roll (env2.py:164-216)", () => {
    const env = makeEnv();
    const { obs, valid } = env.reset();
    expect(env.n).toBe(36);
    expect([...env.alive].filter(Boolean)).toHaveLength(4);
    expect([...env.tech.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    expect([...env.res.slice(0, 4)]).toEqual([10, 10, 10, 10]);
    expect(env.free_pool).toBe(110); // 150 − 40
    expect(env.pending_spawns).toEqual([12.5]); // 恰一个预滚（v2.3）
    expect([...env.spawn_tick.slice(0, 4)].every((t) => t === 0)).toBe(true);
    expect([...env.spawn_tick.slice(4)].every((t) => t === 10 ** 9)).toBe(true);
    expect(env.t).toBe(0);
    expect([...env.last_action]).toEqual(new Array(36).fill(0)); // A_SILENT
    expect(env.obs).toBeDefined();
    expect(obs.length).toBe(36 * 38); // 占位长度（Task 10 实装内容）
    expect(valid.length).toBe(36 * 10);
    assertConservation(env); // 150 − 40 − 110 = 0
});

test("reset: budget overflow scales initial res (env2.py:191-192)", () => {
    // 完整替换构造队列（makeEnv 是追加语义，此处需覆盖基础 81 值）
    const env = new DarkForestEnv2(
        { ...V23_CONFIG },
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 40, 40, 40, 40, 12.5]),
    );
    env.reset();
    // Σres0 = 160 > 150 → 等比缩放到 150（×0.9375，二进制精确）；tech 不受影响
    expect([...env.res.slice(0, 4)].reduce((s, v) => s + v, 0)).toBeCloseTo(150, 10);
    expect([...env.tech.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    expect(env.free_pool).toBeCloseTo(0, 10);
    assertConservation(env);
});

test("consecutive resets: Q1 stale-pos rejection loop (env2.py:170-177)", () => {
    const env = makeEnv();
    env.reset();
    // 首次 reset 无旧 pos → 全 inf 矩阵 → 立即接受：恰好 81 个脚本值被消耗
    expect((env["rng"] as ScriptedRng).consumed).toBe(81);
    // 第二次 reset：拒绝环读取【旧】 pos（全同点 → 全部对 <12 为 bad）→
    // 每轮只重掷首个 bad 对（(0,1)）两值、循环 400 次 → 72+4+4+1+800 = 881
    env.reset();
    expect((env["rng"] as ScriptedRng).consumed).toBe(81 + 881);
});
