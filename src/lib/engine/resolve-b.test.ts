import { expect, test } from "bun:test";

import { assertConservation } from "./snapshot";
import { makeEnv, tick } from "./test-helpers";
import { ScriptedRng } from "./rng";

test("strike kill: alive cleared, cause=strike, corpse to pool (env2.py:467-507)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999; // 抑制同刻出生，pool 断言才封闭
    env.known[0 * 36 + 1] = 1;
    env.tech[0] = 8;
    env.tech[1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(0);
    expect(env.death_cause[1]).toBe("strike");
    expect(result.info.strike_events).toEqual([[0, 1, "killed", 8, 1, 0]]);
    expect(result.info.strikes).toEqual([[0, 1, true]]);
    expect(result.info.died_this_tick).toEqual([[1, "strike"]]);
    expect(result.info.strikes_blocked).toEqual([]);
    expect(env.free_pool).toBeCloseTo(110 + 10, 10); // 尸体（默认 res 10）入池——8b（Task 9 实装，此刻发生在打击段内的资源守恒仍成立）
    expect(env.res[1]).toBe(0);
    assertConservation(env);
});

test("shield block: tech_j >= 2*tech_i, no RNG consumed (Q12, env2.py:484-489)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.tech[0] = 8;
    env.tech[1] = 20; // ≥ 2×8 → 护盾
    env.res[1] = 10;
    const actions = new Int32Array(36);
    actions[0] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const before = (env.rng as ScriptedRng).consumed;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(1);
    expect(result.info.strikes_blocked).toEqual([[0, 1, 5]]);
    expect(result.info.strike_events).toEqual([[0, 1, "blocked", 8, 20, 5]]);
    expect(result.info.strikes).toEqual([]); // 掷骰从未发生
    expect(env.res[1]).toBeCloseTo(5, 10);
    expect(env.free_pool).toBeCloseTo(115, 10);
    // consumed 按值计数：探测 1296 + boom 36 + 流失 36（经济两批恒抽样），打击零消耗
    expect((env.rng as ScriptedRng).consumed).toBe(before + 1296 + 72);
    assertConservation(env);
});

test("invasion: guaranteed kill + half loot (env2.py:508-547)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1; // res 默认 [10,10,10,10]，勿篡改（守恒）
    const actions = new Int32Array(36);
    actions[0] = 6;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(0);
    expect(env.death_cause[1]).toBe("invade");
    expect(result.info.invasions).toEqual([[0, 1, false]]);
    expect(env.res[0]).toBeCloseTo(15, 10); // 10 + 5
    expect(result.info.loot_to[0]).toBeCloseTo(5, 10);
    expect(env.res[1]).toBe(0); // 剩余半具经 8b 入池
    expect(env.free_pool).toBeCloseTo(115, 10); // 110 + 尸体 5
    expect(result.info.died_this_tick).toEqual([[1, "invade"]]);
    assertConservation(env);
});

test("counter-invade needs no valid target (Q9) → mutual, no loot (env2.py:516-523)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 6;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    env.beginTick(actions, targets); // 1 收到通知（known[1,0]=1）
    const re = Int32Array.from(actions);
    re[1] = 6; // 反咬——targets[1] 仍 -1，无显式目标也生效
    const { result } = tick(env, actions, targets, re);
    expect(env.alive[0]).toBe(0);
    expect(env.alive[1]).toBe(0);
    expect(env.death_cause[0]).toBe("mutual");
    expect(env.death_cause[1]).toBe("mutual");
    expect(result.info.invasions).toEqual([
        [0, 1, true],
        [1, 0, true],
    ]);
    expect([...result.info.loot_to].every((v) => v === 0)).toBe(true);
    expect(result.info.died_this_tick).toEqual([
        [0, "mutual"],
        [1, "mutual"],
    ]);
    assertConservation(env);
});

test("victim re-choosing BD cancels the invasion (windup immune, Q4, env2.py:513-514)", () => {
    const env = makeEnv();
    env.reset();
    env.known[0 * 36 + 1] = 1;
    env.tech[1] = 6; // BD 门 tech>5
    const actions = new Int32Array(36);
    actions[0] = 6;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    env.beginTick(actions, targets);
    const re = Int32Array.from(actions);
    re[1] = 5; // 黑域
    const { result } = tick(env, actions, targets, re);
    expect(env.alive[1]).toBe(1);
    expect(env.domain_windup[1]).toBe(1);
    expect(result.rewards[1]).toBe(-0.5); // 入场罚
    expect(result.info.invasions).toEqual([]); // 入侵被取消
});

test("p_kill low clip 0.15 at extreme negative Δtech; high clip 0.95", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.tech[0] = 8;
    env.tech[1] = 15; // < 2×8=16 → 无护盾；Δ=−7 → 0.55−0.84 → clip 0.15
    const actions = new Int32Array(36);
    actions[0] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets); // 掷骰 fill 0.5 > 0.15 → 幸存
    expect(result.info.strike_events).toEqual([[0, 1, "survived", 8, 15, 0]]);
    expect(env.alive[1]).toBe(1);
});

test("STRIKE without valid explicit target falls back to nearest known (argmin ties→first)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1; // 全同点 → 距离并列，argmin 取先
    env.tech[0] = 9;
    env.tech[1] = 5;
    env.tech[2] = 3;
    const actions = new Int32Array(36);
    actions[0] = 4; // 显式 targets[0] = -1 → 最近兜底
    const { result } = tick(env, actions);
    expect(result.info.strike_events[0][1]).toBe(1);
});

// ---- v2.4：BROADCAST_OTHER（揭露）与 OBSERVE 显式目标 ----

test("BOTHER reveal: target public+known to all next tick, sender NOT exposed (env2_v24.py:457-472)", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6; // 广播门 tech>1
    env.known[0 * 36 + 1] = 1; // 0 揭露 1
    const actions = new Int32Array(36);
    actions[0] = 3; // BOTHER
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(env.pending_reveal).toEqual([["other", 1]]); // 本刻入队
    expect(result.rewards[0]).toBe(0); // 默认 attack_reward=0
    tick(env, new Int32Array(36)); // 结算
    expect(env.public_[1]).toBe(1); // 目标全场公开
    expect(env.known[2 * 36 + 1]).toBe(1); // 存活者获知目标坐标
    expect(env.known[3 * 36 + 1]).toBe(1);
    expect(env.public_[0]).toBe(0); // 发送者不暴露
    expect(env.known[1 * 36 + 0]).toBe(0); // 目标也不知道是谁揭露的（归因歧义=机制）
});

test("BOTHER without explicit target: no reveal queued, no reward (env2_v24.py:468-472)", () => {
    const env = makeEnv([], 0.5, { attackReward: 0.5 });
    env.reset();
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 3; // 无目标（-1）
    const { result } = tick(env, actions);
    expect(env.pending_reveal).toEqual([]);
    expect(result.rewards[0]).toBe(0);
});

test("BOTHER reveal pays attack_reward; strike kill / invasion kill too (reward arms, env2_v24.py:472/508/548)", () => {
    const env = makeEnv([], 0.5, { attackReward: 0.5 });
    env.reset();
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 3;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(result.rewards[0]).toBe(0.5); // 揭露赏金
    expect(result.rewardDetail.attackCount[0]).toBe(1); // TS-only 诊断
});

test("strike kill pays attack_reward (first claimant only)", () => {
    const env = makeEnv([], 0.5, { attackReward: 0.5 });
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.tech[0] = 8;
    env.tech[1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(result.rewards[0]).toBeCloseTo(0.5, 12);
    expect(result.rewardDetail.attackCount[0]).toBe(1);
    expect(result.rewardDetail.techTerm[0]).toBe(0); // 非 DEVELOP 刻无津贴
});

test("invasion kill pays attack_reward to surviving invader; mutual destruction pays none (env2_v24.py:548)", () => {
    const env = makeEnv([], 0.5, { attackReward: 0.5 });
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 6;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    const { result } = tick(env, actions, targets); // 单向入侵：0 幸存缴获
    expect(result.rewards[0]).toBeCloseTo(0.5, 12);
    expect(result.rewardDetail.attackCount[0]).toBe(1);

    const env2_ = makeEnv([], 0.5, { attackReward: 0.5 });
    env2_.reset();
    env2_.pending_spawns[0] = 9999;
    env2_.known[0 * 36 + 1] = 1;
    env2_.beginTick(actions, targets);
    const re = Int32Array.from(actions);
    re[1] = 6; // 反咬 → 互毁：killer 同刻死 → 无缴获即无赏金
    const r1 = tick(env2_, actions, targets, re);
    expect(r1.result.rewards[0]).toBe(-10); // 互毁仅死亡罚，无 +0.5 赏金
    expect(r1.result.rewards[1]).toBe(-10);
    expect(r1.result.rewardDetail.attackCount[0]).toBe(0);
});

test("OBSERVE explicit target overrides nearest (env2_v24.py:565-569)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1; // 全同点：最近=1（平手取先）
    const actions = new Int32Array(36);
    actions[0] = 7;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 2; // 显式选 2
    tick(env, actions, targets);
    expect(env.observed[0 * 36 + 2]).toBe(1);
    expect(env.observed[0 * 36 + 1]).toBe(0);
});

test("OBSERVE without target falls back to nearest known", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1;
    const actions = new Int32Array(36);
    actions[0] = 7;
    tick(env, actions); // 无目标
    expect(env.observed[0 * 36 + 1]).toBe(1); // 最近（平手取先）
    expect(env.observed[0 * 36 + 2]).toBe(0);
});

test("two strikers one victim: first kill recorded once, second still rolls an event", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.known[2 * 36 + 1] = 1;
    env.tech[0] = 9;
    env.tech[2] = 8;
    env.tech[1] = 1;
    const actions = new Int32Array(36);
    actions[0] = 4;
    actions[2] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    targets[2] = 1;
    const { result } = tick(env, actions, targets); // 两者掷骰均 fill 0.5 → killed、survived?（p 均高→都 killed 事件）
    expect(result.info.strike_events.length).toBe(2);
    expect(result.info.died_this_tick).toEqual([[1, "strike"]]); // 只死一次
    expect(env.alive[1]).toBe(0);
    assertConservation(env);
});

test("corpse can still be shield-drained by a later same-tick strike (order fidelity, env2.py:484-489)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;
    env.known[2 * 36 + 1] = 1;
    env.tech[0] = 20; // i=0 先杀（p=0.55+0.12×3=0.91>0.5）
    env.tech[2] = 8; // i=2 后到：17 ≥ 16 → 护盾，扣的是"本刻已死未结算"尸体
    env.tech[1] = 17;
    const actions = new Int32Array(36);
    actions[0] = 4;
    actions[2] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    targets[2] = 1;
    const { result } = tick(env, actions, targets);
    expect(result.info.strike_events).toEqual([
        [0, 1, "killed", 20, 17, 0],
        [2, 1, "blocked", 8, 17, 5],
    ]);
    // 护盾先扣 5（res 10→5、pool +5），随后 8b 把尸体余量 5 也入池：pool=110+5+5
    expect(env.res[1]).toBe(0);
    expect(env.free_pool).toBeCloseTo(120, 10);
    assertConservation(env);
});

test("invader killed earlier this tick → invasion skipped (env2.py:511)", () => {
    const env = makeEnv();
    env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1; // 0 要入侵 1
    env.known[2 * 36 + 0] = 1; // 2 要打击 0
    env.tech[0] = 1;
    env.tech[2] = 9; // 2 必杀 0（p=0.95>0.5）
    const actions = new Int32Array(36);
    actions[0] = 6;
    actions[2] = 4;
    const targets = new Int32Array(36).fill(-1);
    targets[0] = 1;
    targets[2] = 0;
    const { result } = tick(env, actions, targets);
    expect(env.alive[0]).toBe(0);
    expect(env.death_cause[0]).toBe("strike");
    expect(env.alive[1]).toBe(1); // 入侵随攻击者死亡而取消
    expect(result.info.invasions).toEqual([]);
    expect(result.info.died_this_tick).toEqual([[0, "strike"]]);
    assertConservation(env);
});
