import { expect, test } from "bun:test";

import { V23_CONFIG } from "@/lib/engine/config";
import { ScriptedRng } from "@/lib/engine/rng";
import type { EndView } from "./match";
import { SoloMatch as Match } from "./match";

/**
 * 场景编排说明：makeEnv 式基础队列（72 pos 全 0.02 同点、techs [1,2,3,4]、res 全 10、
 * 预滚 12.5）经 envRng 注入；fill=0.01 → 探测全触发（p ≥ 0.03·√1 = 0.03 > 0.01）。
 * presetRng 队列按时刻排列（random 预设：每活席一次 choice，目标二选再一次 choice）。
 */
function baseEnvRng(fill = 0.01) {
    return new ScriptedRng(
        [...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5],
        fill,
    );
}

test("start: queued ghost tick until player birth (ordinal 4), then awaiting-action", () => {
    const m = new Match(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
    expect(m.phase).toBe("queued");
    m.start();
    expect(m.playerSlot).toBe(4);
    expect(m.env.alive[4]).toBe(1);
    expect(m.phase).toBe("awaiting-action");
    expect(m.env.t).toBe(1);
});

test("submitAction guards: wrong phase / invalid action / after end all throw", () => {
    const m = new Match(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
    m.start();
    expect(() => m.submitRechoice(0)).toThrow(/phase/); // awaiting-action 下不可重选
    expect(() => m.submitAction(4, -1)).toThrow(/invalid/); // tech≈2.5 无已知 → STRIKE 非法
    const t0 = m.env.t;
    m.submitAction(0, -1); // SILENT
    expect(m.env.t).toBe(t0 + 1);
    // 强制终局（env 公开为测试接缝）
    const m2 = new Match(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
    m2.env.alive.fill(0);
    m2.env.pending_spawns[0] = 9999;
    m2.start();
    expect(m2.phase).toBe("ended");
    expect(m2.getEnd()).toEqual({ kind: "unborn" });
    expect(() => m2.submitAction(0, -1)).toThrow(/ended/);
});

test("player invaded → awaiting-rechoice; counter-invade → mutual death (Q9)", () => {
    // presetRng 队列（random 预设：每活席一次 choice；目标二选再一次 choice）：
    // t0/t1 四席 DEVELOP（非静默——静默 ×0.25 截面会使全互探熄火）；t2 五席（slot5 于 t1 内生出生）
    // slot0=INVADE、余 SILENT，目标二选弹 4=玩家。玩家 t1 出生、探测刻中结算 → t2 才可被入侵。
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4],
        0.5,
    );
    const m = new Match(7, ["random"], new Map(), { envRng: baseEnvRng(), presetRng });
    m.start(); // t0：出生 slot4
    m.submitAction(1, -1); // t1：DEVELOP（非静默，slot0 刻中探测到玩家）
    expect(m.phase).toBe("awaiting-action");
    m.submitAction(1, -1); // t2：slot0 入侵玩家
    expect(m.phase).toBe("awaiting-rechoice");
    expect(m.getPendingInvader()).toBe(0);
    m.submitRechoice(6); // 反咬——无显式目标也生效
    expect(m.phase).toBe("ended");
    const end = m.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("mutual");
    expect(end.kills).toBe(0);
    expect(end.loot).toBe(0);
});

test("re-choose BD cancels the invasion; cancel keeps the original action", () => {
    const mk = () =>
        new Match(7, ["random"], new Map(), {
            envRng: baseEnvRng(),
            presetRng: new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4], 0.5),
        });
    // 黑域取消：玩家 BD 须合法（tech>5）——出生科技≈0.01（脚本原样），经 env 接缝上调
    const m1 = mk();
    m1.start();
    m1.env.tech[4] = 6;
    m1.submitAction(1, -1);
    m1.submitAction(1, -1);
    expect(m1.phase).toBe("awaiting-rechoice");
    expect(() => m1.submitRechoice(5)).not.toThrow(); // tech=6 → BD 合法
    expect(m1.env.alive[4]).toBe(1);
    expect(m1.env.domain_windup[4]).toBe(1); // 入场风窗（入侵被取消）
    expect(m1.phase).toBe("awaiting-action");
    // 取消 = 保持原动作：入侵照常结算 → 玩家死于 invade
    const m2 = mk();
    m2.start();
    m2.submitAction(1, -1);
    m2.submitAction(1, -1);
    expect(m2.phase).toBe("awaiting-rechoice");
    m2.submitRechoice(0); // 保持 SILENT（t2 的原动作改为静默即可被入侵击杀）
    const end = m2.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("invade");
});

test("won: alive at t_max", () => {
    const m = new Match(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
    m.start();
    m.env.t = V23_CONFIG.tMax - 2; // 接缝：直接推到末两刻
    m.submitAction(0, -1);
    m.submitAction(0, -1);
    expect(m.phase).toBe("ended");
    const end = m.getEnd() as Extract<EndView, { kind: "won" }>;
    expect(end.kind).toBe("won");
    expect(end.nAlive).toBeGreaterThan(0);
    expect(m.getEnd()!.kind).toBe("won");
});

test("stats: own strike kill + invade loot accumulate from info (rule ①)", () => {
    // fill=0.025：探测火（< p_row≈0.03+）而流失不触发（≥0.02）——res 保持 10，loot 恰 5。
    // presetRng fill=0.3：pacifist 恒 DEVELOP（非静默 → 玩家可探测到全部 AI）。
    // 玩家经接缝上调 tech=9 → STRIKE/INVADE 合法。
    const m = new Match(7, ["pacifist"], new Map(), {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    m.start();
    m.env.tech[4] = 9;
    m.submitAction(1, -1); // t1：刻中玩家探测到 1,2,3 → known[4,*]
    expect(m.env.known[4 * 36 + 1]).toBe(1);
    m.submitAction(4, 1); // t2：STRIKE slot1（p=0.95 > 掷骰 0.025）
    expect(m.env.death_cause[1]).toBe("strike");
    expect(m.stats().kills).toBe(1);
    expect(m.stats().loot).toBe(0);
    m.submitAction(6, 2); // t3：INVADE slot2 → loot = 0.5×10
    expect(m.stats().loot).toBe(5);
    expect(m.stats().kills).toBe(2);
    expect(m.env.alive[2]).toBe(0);
});
