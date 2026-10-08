/**
 * info 事件流字段字典与 env2.py:616-627 逐一对齐（验收门 4）。
 * 构造一个"探测→同刻打击命中 + 入侵掠夺 + 尸体结算 + 内生出生"的多事件刻，
 * 全字段形状与数值一并锁定。探测先于打击：同刻发现可同刻被打（CLAUDE.md 口径）。
 */
import { expect, test } from "bun:test";

import { assertConservation } from "./snapshot";
import { makeEnv, tick } from "./test-helpers";

test("info dictionary parity on a multi-event tick (env2.py:616-627)", () => {
    const env = makeEnv([], 0.1); // 全坐标同点 → 距离 0 ≤ 30
    env.reset();
    env.tech[0] = 100; // 探测行 p = min(0.03·10, 0.35) = 0.3 > 0.1
    env.known[0 * 36 + 1] = 1; // 先验已知——sanitize（阶段前）按 any_known 判定，零已知打击者本就降级 SILENT
    env.known[2 * 36 + 3] = 1; // 2 号预知 3 号（供入侵目标）
    const actions = new Int32Array(36);
    actions[0] = 4; // STRIKE——目标缺省 → 最近已知（同刻新探测的 2、3 亦为合法目标）
    actions[1] = 1; // DEVELOP（非静默——静默会缩截面 0.3×0.25=0.075 < 0.1）
    actions[2] = 6; // INVADE 3
    actions[3] = 1; // 同上
    const targets = new Int32Array(36).fill(-1);
    targets[2] = 3;
    const { result } = tick(env, actions, targets);

    // 探测（阶段 2）先于打击（阶段 4）：known[0,·] 的同刻增量成为打击候选；(0,1) 已知不重复探测
    expect(result.info.detections).toEqual([
        [0, 2],
        [0, 3],
    ]);
    // 打击：显式目标缺省 → 最近已知（全同点平手取先 = slot 1，其基础科技 = 2）；p=clip 0.95 > 0.1 命中
    expect(result.info.strike_events).toEqual([[0, 1, "killed", 100, 2, 0]]);
    expect(result.info.strikes).toEqual([[0, 1, true]]);
    expect(result.info.strikes_blocked).toEqual([]);
    // 入侵：必杀 + 掠夺半数
    expect(result.info.invasions).toEqual([[2, 3, false]]);
    expect(result.info.loot_to[2]).toBeCloseTo(5, 10);
    expect([...result.info.loot_to].filter((v) => v !== 0)).toEqual([5]);
    // 死亡：升序、原因齐备
    expect(result.info.died_this_tick).toEqual([
        [1, "strike"],
        [3, "invade"],
    ]);
    // 全局读数
    expect(result.info.n_alive).toBe(3); // 4 − 2 死 + 1 生
    expect(result.info.n_births).toBe(1); // 尸体 10+5 入池 → 125 ≥ 预滚 → slot 4 出生
    expect(result.info.in_domain).toBe(0);
    expect(result.info.counter_detections).toBe(0);
    expect(result.info.free_pool).toBeCloseTo(110 + 10 + 5 - 12.5, 10);
    expect(Math.abs(result.info.res_conservation_residual)).toBeLessThanOrEqual(1e-6);
    expect(env.birth_log).toEqual([[1, 4, 12.5]]);
    assertConservation(env);
});
