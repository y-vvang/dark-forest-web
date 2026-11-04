import { expect, test } from "bun:test";

import { V25_CONFIG } from "./config";
import { DarkForestEnv2 } from "./env";
import { ScriptedRng } from "./rng";
import { OBS_DIM } from "./types";

/**
 * v2.5 死槽复用（env2_v25.py:309-359——**缺省行为**，原 slotReuse 偏离条款消解）：
 * 槽偏好三级 = 最靠前未生槽 → 最靠前已死槽（社会态全清）→ _grow 扩容。
 * 复用 = 恒星位置不变 + 零额外 RNG（仅消耗预滚重抽）+ 权威清除清单
 * （known/observed 行列、public、under_attack、in_domain、windup、
 * first_detect_tick、last_action、death_cause；peak_tech 由公共路径重置 :356）。
 * **照抄的 v2.5 语义（勿"修复"）**：last_invader 不清（复生 df 可反咬前任
 * 入侵者）；pending_reveal/pending_counter 不滤（死者被揭露 → 复生者出生即
 * public 的信息穿越）；同刻死者即可复用（无 deadNow 跳过——死因先于
 * died_this_tick 装配被清空，事件流死因 "" 由视图层 cause.unknown 兜底）。
 */
function freshEnv(): DarkForestEnv2 {
    const env = new DarkForestEnv2(
        V25_CONFIG,
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5], 0.5),
    );
    env.reset();
    return env;
}

test("recycle: never-born slots are preferred before reusing dead ones", () => {
    const env = freshEnv();
    env.spawn_tick[4] = 1; // 已生已死的槽 4
    env.alive[4] = 0;
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    env.activatePendingSpawns();
    expect(env.spawn_tick[5]).toBe(env.t + 1); // 最靠前未生槽 5（不复用 4）
    expect(env.alive[4]).toBe(0);
});

test("recycle: exhausted slots rebirth in the first dead slot with the v2.5 wipe list", () => {
    const env = freshEnv();
    const rng = env.rng as ScriptedRng;
    for (let i = 4; i < 36; i++) env.spawn_tick[i] = 1; // 耗尽全部未生槽
    env.alive[4] = 1; // 4 在世（否则它成为复用目标）
    // 杀 slot 5 并污染其全部认知态
    env.alive[5] = 0;
    env.death_cause[5] = "starve";
    env.public_[5] = 1;
    env.under_attack[5] = 1;
    env.last_invader[5] = 7;
    env.peak_tech[5] = 9;
    env.in_domain[5] = 1;
    env.domain_windup[5] = 1;
    env.known[7 * 36 + 5] = 1; // 列（他人知 5）
    env.known[5 * 36 + 7] = 1; // 行（5 知他人）
    env.observed[7 * 36 + 5] = 1;
    env.observed[5 * 36 + 7] = 1;
    env.last_action[5] = 1;
    env.pending_reveal.push(["other", 5]); // v2.5 不滤——born-public 穿越素材
    env.pending_reveal.push(["other", 6]); // 非复用目标条目照常保留
    env.pending_counter.push(5, 7);
    const posBefore = [env.pos[5 * 2], env.pos[5 * 2 + 1]];
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    const consumedBefore = rng.consumed;
    env.activatePendingSpawns();
    // 重生在最靠前已死槽；出生属性与新生同构 + peak_tech 逐代重置（v2.5 :356）
    expect(env.alive[5]).toBe(1);
    expect(env.tech[5]).toBe(V25_CONFIG.techSpawnLo);
    expect(env.res[5]).toBe(12.5);
    expect(env.free_pool).toBe(20 - 12.5);
    expect(env.spawn_tick[5]).toBe(env.t + 1);
    expect(env.peak_tech[5]).toBe(V25_CONFIG.techSpawnLo);
    // 恒星位置不变；RNG 仅消耗预滚下一额一次（消耗序与新生同构）
    expect([env.pos[5 * 2], env.pos[5 * 2 + 1]]).toEqual(posBefore);
    expect(rng.consumed - consumedBefore).toBe(1);
    // 权威清除清单（env2_v25.py:332-340）
    expect(env.known[7 * 36 + 5]).toBe(0);
    expect(env.known[5 * 36 + 7]).toBe(0);
    expect(env.observed[7 * 36 + 5]).toBe(0);
    expect(env.observed[5 * 36 + 7]).toBe(0);
    expect(env.public_[5]).toBe(0);
    expect(env.under_attack[5]).toBe(0);
    expect(env.in_domain[5]).toBe(0);
    expect(env.domain_windup[5]).toBe(0);
    expect(String(env.death_cause[5])).toBe(""); // String() 防字面量窄化
    expect(env.last_action[5]).toBe(0);
    // v2.5 照抄语义：last_invader 存活 + pending_reveal/counter 不滤（信息穿越面）
    expect(env.last_invader[5]).toBe(7);
    expect(env.pending_reveal.some((e) => e[1] === 5)).toBe(true);
    expect(env.pending_reveal.some((e) => e[1] === 6)).toBe(true);
    expect(env.pending_counter.includes(5)).toBe(true);
    expect(env.pending_counter.includes(7)).toBe(true);
    expect(env.birth_log[env.birth_log.length - 1]).toEqual([env.t + 1, 5, 12.5]);
});

test("recycle: same-tick death is recyclable immediately (v2.5 has no deadNow skip)", () => {
    const env = freshEnv();
    for (let i = 4; i < 36; i++) env.spawn_tick[i] = 1; // 无未生槽
    for (let i = 4; i < 36; i++) env.alive[i] = 1; // 全在场——仅 5 本刻刚死
    env.alive[5] = 0;
    env.death_cause[5] = "strike";
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    env.activatePendingSpawns();
    expect(env.alive[5]).toBe(1); // 同刻死者立即被复用（v2.4 游戏侧曾推迟一刻）
    expect(String(env.death_cause[5])).toBe(""); // 死因被清——上层须 cause.unknown 兜底
});

test("recycle: pending reveal on a recycled slot fires on the reborn civ (born public)", () => {
    const env = freshEnv();
    // 阶段 3 已入队对 5 的揭露；5 本刻死亡且槽位被复用
    for (let i = 4; i < 36; i++) env.spawn_tick[i] = 1;
    for (let i = 4; i < 36; i++) env.alive[i] = 1;
    env.alive[5] = 0;
    env.pending_reveal.push(["other", 5]);
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    env.activatePendingSpawns();
    expect(env.alive[5]).toBe(1);
    expect(env.public_[5]).toBe(0); // 复用清除——穿越尚未发生
    // 下一刻阶段 1：延迟公开落在复生者头上（born-public 信息穿越 quirk 照抄）
    const actions = new Int32Array(env.n);
    env.beginTick(actions, null);
    env.resolve(actions);
    expect(env.public_[5]).toBe(1);
    expect(env.known[5 * env.n + 5]).toBe(1); // 复生者"自知"被公开（含对角 Q2）
    expect(env.known[0 * env.n + 5]).toBe(1); // 阶段 1 时在世者全体知 5
});

test("grow: full world + affordable pool widens arrays mid-resolve (Q16 keeps obs sane)", () => {
    const env = freshEnv();
    for (let i = 0; i < 36; i++) {
        env.spawn_tick[i] = 1;
        env.alive[i] = 1; // 全员在场——阶段 10 只能走 _grow
        env.res[i] = 10; // 须有资源：否则阶段 8 饿死 → 阶段 10 走复用而非增长
    }
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    // 经完整 resolve 触发：阶段 10 内扩容——Q16 路径（ctx.eff 旧长 36，尾部须拷入
    // 72 长数组；python `self.last_action = eff` 在此处埋雷，下刻 _obs 形状崩溃）
    const actions = new Int32Array(36);
    env.beginTick(actions, null);
    const r = env.resolve(actions);
    expect(env.n).toBe(72); // new_n = max(2×36, 37)
    expect(env.alive[71]).toBe(1); // 新住客在最后的新槽
    expect(env.spawn_tech[71]).toBe(V25_CONFIG.techSpawnLo);
    expect(env.birth_log[env.birth_log.length - 1]).toEqual([env.t, 71, 12.5]);
    // Q16 修复：last_action 保持 72 长（新槽 A_SILENT），下刻 obs/valid 形状自洽
    expect(env.last_action.length).toBe(72);
    expect(env.last_action[36]).toBe(0);
    expect(env.last_invader[36]).toBe(-1);
    expect(r.obs.length).toBe(72 * OBS_DIM);
    expect(r.valid.length).toBe(72 * 8);
});
