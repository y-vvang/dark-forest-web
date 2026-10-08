import { expect, test } from "bun:test";

import { makeEnv, tick } from "./test-helpers";
import { assertConservation } from "./snapshot";

test("resolve skeleton: silent tick advances, empty info, conservation (env2.py:362-628)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999; // 抑制出生——本用例意图是"无事件刻"；出生行为由 resolve-c 锁定
    const { result } = tick(env, new Int32Array(36));
    expect(env.t).toBe(1);
    expect([...env.last_action]).toEqual(new Array(36).fill(0)); // 全 SILENT
    expect(result.done).toBe(false);
    expect(result.info.detections).toEqual([]);
    expect(result.info.strikes).toEqual([]);
    expect(result.info.invasions).toEqual([]);
    expect(result.info.died_this_tick).toEqual([]);
    expect(result.info.n_births).toBe(0);
    expect(result.info.n_alive).toBe(4);
    expect(result.info.free_pool).toBe(110);
    expect(Math.abs(result.info.res_conservation_residual)).toBeLessThanOrEqual(1e-6);
    assertConservation(env);
});

test("sanitize: no-known striker downgraded to SILENT; domain rows keep only DEV/BD/SILENT", () => {
    const env = makeEnv();
    env.reset();
    const actions = new Int32Array(36);
    actions[0] = 4; // STRIKE 无任何 known
    env.known[1 * 36 + 2] = 1;
    env.in_domain[1] = 1;
    actions[1] = 4; // 域内打击 → SILENT
    tick(env, actions);
    expect(env.last_action[0]).toBe(0);
    expect(env.last_action[1]).toBe(0);
});

test("domain: declare BD → windup now, active next tick, -0.5 reward (env2.py:395-400)", () => {
    const env = makeEnv();
    env.reset(); // techs [1,2,3,4]
    env.tech[0] = 6;
    const actions = new Int32Array(36);
    actions[0] = 5; // BLACK_DOMAIN
    const { result } = tick(env, actions);
    expect(env.domain_windup[0]).toBe(1);
    expect(env.in_domain[0]).toBe(0);
    expect(result.rewards[0]).toBe(-0.5);
    tick(env, new Int32Array(36));
    expect(env.in_domain[0]).toBe(1);
    expect(env.domain_windup[0]).toBe(0);
});

test("counter-detection: observer exposed to one random alive civ (env2.py:402-418)", () => {
    const env = makeEnv([2], 0.5); // choice 弹出脚本值 2 → cand [1,2,3] 中选 slot 2
    env.reset();
    env.pending_counter = [0];
    const { result } = tick(env, new Int32Array(36));
    expect(env.known[2 * 36 + 0]).toBe(1);
    expect(result.info.detections).toEqual([[2, 0]]);
    expect(result.info.counter_detections).toBe(1);
    expect(env.pending_counter).toEqual([]);
});

test("delayed broadcast resolves even if sender died (dying curse, env2.py:420-425)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_reveal = [["self", 2]];
    env.alive[2] = 0; // 发送者已死——信号照常发出
    tick(env, new Int32Array(36));
    expect(env.known[0 * 36 + 2]).toBe(1); // 存活者获知
    expect(env.public_[2]).toBe(1);
    expect(env.known[2 * 36 + 2]).toBe(0); // 死行不在 known[alive, j] 赋值范围
});

test("delayed broadcast: Q2 — living broadcaster knows itself (known[j,j])", () => {
    const env = makeEnv();
    env.reset();
    env.pending_reveal = [["self", 1]];
    tick(env, new Int32Array(36));
    expect(env.known[1 * 36 + 1]).toBe(1); // Q2：广播者自知
    expect(env.public_[1]).toBe(1);
});

test("passive detection: p matrix, row-major order (env2.py:427-442)", () => {
    const env = makeEnv([], 0.2); // 全部坐标 (0.02,0.02) → 距离 0 ≤ 30
    env.reset();
    env.tech[0] = 100; // 行 0：p = min(0.03·10, 0.35) = 0.3 > 0.2
    const { result } = tick(env, new Int32Array(36).fill(1)); // 全 DEVELOP（非静默）
    expect(result.info.detections).toEqual([
        [0, 1],
        [0, 2],
        [0, 3],
    ]);
    expect(env.known[0 * 36 + 1]).toBe(1);
});

test("stealth: SILENT target ×0.25 → 0.075 < 0.2 not detected; domain detector rows zeroed", () => {
    const env = makeEnv([], 0.2);
    env.reset();
    env.tech[0] = 100;
    const actions = new Int32Array(36).fill(1);
    actions[3] = 0; // 3 号静默
    const { result } = tick(env, actions);
    expect(result.info.detections).toEqual([
        [0, 1],
        [0, 2],
    ]);
    const env2_ = makeEnv([], 0.2);
    env2_.reset();
    env2_.tech[0] = 100;
    env2_.in_domain[0] = 1; // 域内探测者 → 行全零
    const r2 = tick(env2_, new Int32Array(36).fill(1));
    expect(r2.result.info.detections).toEqual([]);
});

test("broadcast queued this tick reveals next tick (env2.py:444-450)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6; // BSELF 门：tech>1
    const actions = new Int32Array(36);
    actions[0] = 2;
    tick(env, actions);
    expect(env.pending_reveal).toEqual([["self", 0]]);
    tick(env, new Int32Array(36));
    expect(env.public_[0]).toBe(1);
    expect(env.known[1 * 36 + 0]).toBe(1); // 存活者获知
    expect(env.known[0 * 36 + 0]).toBe(1); // Q2：广播者自知
});
