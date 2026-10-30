import { expect, test } from "bun:test";

import { V24_CONFIG } from "./config";
import { DarkForestEnv2 } from "./env";
import { ScriptedRng } from "./rng";

/**
 * 槽复用（用户 2026-10-14 指令"取消 36 上限"——在线多生命世界的**明示偏离**：
 * v2.4 引擎 Q11 一次性槽位在全部 36 槽耗尽后允许复用已死槽）。金标准绊网实证
 * trace-main-s1/d 等暴力世界**会耗尽 36 槽** ⇒ 缺省（slotReuse=false）必须保
 * 持忠实，复用仅经 ONLINE_ENV_CONFIG 显式开启。
 * 复用 = 恒星位置不变（"恒星位置永不变"字面保持；零额外 RNG，消耗序与新生
 * 同构）+ 该槽认知态全清（防死者揭发新主/幽灵反曝光）。
 */
/** 复用仅 slotReuse 世界开启（明示偏离；缺省 = 忠实 v2.4——金标准轨迹实证
 *  暴力世界会耗尽 36 槽，缺省开启即破坏奇偶） */
const REUSE_CFG = { ...V24_CONFIG, slotReuse: true };

function freshEnv(): DarkForestEnv2 {
    const env = new DarkForestEnv2(
        REUSE_CFG,
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5], 0.5),
    );
    env.reset();
    return env;
}

test("reuse: never-born slots are preferred before reusing dead ones", () => {
    const env = freshEnv();
    env.spawn_tick[4] = 1; // 模拟"已生已死"的槽 4
    env.alive[4] = 0;
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    env.activatePendingSpawns();
    expect(env.spawn_tick[5]).toBe(env.t + 1); // 最靠前未生槽 5（不复用 4）
});

test("reuse: exhausted slots rebirth in the first dead slot with cognition reset", () => {
    const env = freshEnv();
    const rng = env.rng as ScriptedRng;
    // 耗尽全部未生槽：4..35 标记已生（4 伪装在世——否则它成为复用目标）
    for (let i = 5; i < 36; i++) env.spawn_tick[i] = 1;
    env.spawn_tick[4] = 1;
    env.alive[4] = 1;
    // 杀 slot 5 并污染其全部认知态
    env.alive[5] = 0;
    env.death_cause[5] = "starve";
    env.public_[5] = 1;
    env.in_domain[5] = 1;
    env.domain_windup[5] = 1;
    env.known[7 * 36 + 5] = 1; // 列（他人知 5）
    env.known[5 * 36 + 7] = 1; // 行（5 知他人）
    env.observed[7 * 36 + 5] = 1;
    env.observed[5 * 36 + 7] = 1;
    env.last_action[5] = 1;
    env.pending_reveal.push(["other", 5]);
    env.pending_reveal.push(["self", 5]);
    env.pending_reveal.push(["other", 6]); // 非复用目标的条目须保留
    env.pending_counter.push(5, 7);
    const posBefore = [env.pos[5 * 2], env.pos[5 * 2 + 1]];
    env.free_pool = 20;
    env.pending_spawns[0] = 12.5;
    const consumedBefore = rng.consumed;
    env.activatePendingSpawns();
    // 重生在最靠前已死槽；出生属性与新生同构
    expect(env.alive[5]).toBe(1);
    expect(env.tech[5]).toBe(V24_CONFIG.techSpawnLo);
    expect(env.res[5]).toBe(12.5);
    expect(env.free_pool).toBe(20 - 12.5);
    expect(env.spawn_tick[5]).toBe(env.t + 1);
    // 恒星位置不变；RNG 仅消耗预滚下一额一次（消耗序与新生完全同构）
    expect([env.pos[5 * 2], env.pos[5 * 2 + 1]]).toEqual(posBefore);
    expect(rng.consumed - consumedBefore).toBe(1);
    // 认知态全清（行+列/公开/域/风窗/死因/上刻动作）
    expect(env.known[7 * 36 + 5]).toBe(0);
    expect(env.known[5 * 36 + 7]).toBe(0);
    expect(env.observed[7 * 36 + 5]).toBe(0);
    expect(env.observed[5 * 36 + 7]).toBe(0);
    expect(env.public_[5]).toBe(0);
    expect(env.in_domain[5]).toBe(0);
    expect(env.domain_windup[5]).toBe(0);
    expect(String(env.death_cause[5])).toBe(""); // String() 防字面量窄化
    expect(env.last_action[5]).toBe(0);
    // 死者揭发/反曝光清除；非复用槽条目保留
    expect(env.pending_reveal.filter((e) => e[1] === 5)).toHaveLength(0);
    expect(env.pending_reveal.some((e) => e[1] === 6)).toBe(true);
    expect(env.pending_counter.includes(5)).toBe(false);
    expect(env.pending_counter.includes(7)).toBe(true);
    expect(env.birth_log[env.birth_log.length - 1]).toEqual([env.t + 1, 5, 12.5]);
});
