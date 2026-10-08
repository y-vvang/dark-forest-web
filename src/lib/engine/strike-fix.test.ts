/**
 * test_strike_fix.py 的 TS 等价（CLAUDE.md 验收门 1）：10 种子 ×
 * {击杀置死+死因=strike、守恒残差≈0、护盾比≥2 精确挡下}。
 * 击杀掷骰用 rigged 值（0.94 → p=0.95 必中；0.96 → 幸存分支）——Python 原版天然
 * 5% flake，此处确定化（口径披露见 testdata/README）。
 * 队列：基础 81 值 + 探测矩阵 1296×0（techs 置 0 后 p=0，探测不触发判定性）+ 击杀掷骰。
 */
import { expect, test } from "bun:test";

import { assertConservation } from "./snapshot";
import { makeEnv } from "./test-helpers";
import type { DarkForestEnv2, } from "./env";
import type { StrikeEvent, TickInfo } from "./types";

function forceStrike(
    _seed: number, // 名义参数：结构对齐 test_strike_fix.py（断言不依赖随机性）
    techI: number,
    techJ: number,
    killRoll: number,
): { env: DarkForestEnv2; j: number; ev: StrikeEvent[]; info: TickInfo } {
    // 队列：基础 81 值由 makeEnv 垫（勿重复！）→ 探测矩阵 1296×0 → 击杀掷骰
    const env = makeEnv([...Array(1296).fill(0), killRoll], 0.5);
    env.reset(); // seed 为名义参数：结构同 test_strike_fix.py，断言不依赖随机性
    const i = 0;
    const j = 1;
    env.known[i * 36 + j] = 1;
    env.tech[i] = techI;
    env.tech[j] = techJ;
    const actions = new Int32Array(36);
    actions[i] = 4; // A_STRIKE
    const targets = new Int32Array(36).fill(-1);
    targets[i] = j;
    env.beginTick(actions, targets);
    const info = env.resolve(actions).info;
    const ev = info.strike_events.filter((e) => e[0] === i);
    return { env, j, ev, info };
}

for (let s = 0; s < 10; s++) {
    test(`seed ${100 + s}: kill + cause + conservation`, () => {
        const { env, j, ev, info } = forceStrike(100 + s, 20.0, 1.0, 0.94); // Δtech=19 → p=0.95
        expect(env.alive[j]).toBe(0);
        expect(env.death_cause[j]).toBe("strike");
        expect(ev.length).toBeGreaterThan(0);
        expect(ev[0][2]).toBe("killed");
        expect(Math.abs(info.res_conservation_residual)).toBeLessThanOrEqual(1e-6);
        assertConservation(env);
    });
    test(`seed ${200 + s}: shield block at ratio >= 2`, () => {
        const { env, j, ev } = forceStrike(200 + s, 10.0, 25.0, 0.94); // 25 ≥ 2×10，护盾先于掷骰
        expect(env.alive[j]).toBe(1);
        expect(ev.length).toBeGreaterThan(0);
        expect(ev[0][2]).toBe("blocked");
    });
}

test("kill roll above p survives (rigged 0.96 > 0.95)", () => {
    const { env, j, ev } = forceStrike(300, 20.0, 1.0, 0.96);
    expect(env.alive[j]).toBe(1);
    expect(ev[0][2]).toBe("survived");
});
