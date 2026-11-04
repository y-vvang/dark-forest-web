import { expect, test } from "bun:test";

import { makeEnv } from "./test-helpers";
import { OBS_DIM } from "./types";

test("beginTick: invasion notice reveals invader to victim NOW (env2_v25.py:459-469)", () => {
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
    expect(env.under_attack[1]).toBe(1); // v2.5：自知被入侵（重选 obs 即见）
    expect(env.last_invader[1]).toBe(0); // v2.5：最近入侵者入档
    expect(env._invaders.get(1)).toBe(0);
});

test("beginTick: under_attack sliding window (v2.5) — cleared first, survives one tick", () => {
    const env = makeEnv();
    env.reset();
    env.under_attack[2] = 1; // 上一刻的残留旗标（滑窗素材）
    env.under_attack[1] = 1;
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 6; // INVADE
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    expect(env.beginTick(actions, targets)).toEqual([1]);
    expect(env.under_attack[2]).toBe(0); // 先清（上一刻旗标已被看见）
    expect(env.under_attack[1]).toBe(1); // 随本刻通知置位
    // 重选 obs（beginTick 后、resolve 前）立即可见
    expect(env.obs()[1 * OBS_DIM + 7]).toBe(1);
    // 受害者重选 BD 取消入侵（须过 tech 门）→ 幸存 → 下一刻 obs 仍见（供下一刻一选）
    env.tech[1] = 6;
    const re = new Int32Array(36);
    re[1] = 5; // BLACK_DOMAIN 重选——风窗当场取消入侵
    env.resolve(re);
    expect(env.alive[1]).toBe(1);
    expect(env.obs()[1 * OBS_DIM + 7]).toBe(1);
    // 再下一 beginTick 清除；last_invader 非滑窗——持留（v2b 启发式状态）
    env.beginTick(new Int32Array(36), null);
    expect(env.under_attack[1]).toBe(0);
    expect(env.obs()[1 * OBS_DIM + 7]).toBe(0);
    expect(env.last_invader[1]).toBe(0);
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
