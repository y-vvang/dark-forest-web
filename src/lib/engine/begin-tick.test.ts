import { expect, test } from "bun:test";

import { makeEnv } from "./test-helpers";

test("beginTick: invasion notice reveals invader to victim NOW (env2.py:353-360)", () => {
    const env = makeEnv();
    env.reset();
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 6; // INVADE
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const invaded = env.beginTick(actions, targets);
    expect(invaded).toEqual([1]);
    expect(env.known[1 * 36 + 0]).toBe(1); // 受害者当场得知入侵者
    expect(env.first_detect_tick[1 * 36 + 0]).toBe(0);
    expect(env._invaders.get(1)).toBe(0);
});

test("beginTick: invalid target not stored; STRIKE targets stored; dead actor gives no notice", () => {
    const env = makeEnv();
    env.reset();
    const actions = new Int32Array(36);
    actions[0] = 6;
    actions[2] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 5; // 0 不知 5
    targets[2] = 1;
    env.known[2 * 36 + 1] = 1; // 2 号的目标候选才有效
    env.beginTick(actions, targets);
    expect(env.selectTargets(actions)[0 * 36 + 5]).toBe(0); // 候选掩码证其无效
    expect(env._targets.get(2)).toBe(1); // STRIKE 显式目标入库
    expect(env._targets.has(0)).toBe(false);
    env.alive[3] = 0; // 死者入侵 → 无通知（env2.py:356 双方须活）
    actions[3] = 6;
    targets[3] = 1;
    env.known[3 * 36 + 1] = 1;
    expect(env.beginTick(actions, targets)).toEqual([]);
    expect(env._invaders.size).toBe(0);
});
