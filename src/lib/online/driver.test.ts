import { expect, test } from "bun:test";

import { ScriptedRng, type Rng } from "@/lib/engine/rng";
import { getWeights } from "./ai";
import { downgradeStaleTarget, replay, type DriverState } from "./driver";
import { closeWindow, newWorldRecord, openWindow } from "./record";
import type { WorldRecord } from "./types";

/**
 * 场景编排（配方沿用 solo/match.test.ts）：baseEnvRng 前缀 = 72 同点站位 0.02、
 * techs [1,2,3,4]、res 全 10、预滚 12.5（→ 每刻一出生、池够多刻）。
 * fill 分两档：0.01 = 探测全触发（p≥0.03·√1）；0.05 = 静默宇宙——tech-1 截面 0.03
 * 与流失 0.02、爆炸 0.01 全部不触发 → 知识面完全由 afterResolve 接缝注入（同 solo
 * 测试的 env 公开接缝哲学）。modelRng fill 0.5 > ε=0.05 → 四臂恒 greedy（确定性）。
 */
function baseEnvRng(fill: number): ScriptedRng {
    return new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5], fill);
}

const QUIET = 0.05;
const W = () => getWeights();
const greedy = (): Rng => new ScriptedRng([], 0.5);

/** 已推进 steps 窗的记录（窗 i 于 i*20s 开闭）——测试直接往条目写人类提交/重选 */
function bootRecord(tokens: string[], steps: number, seed = 7): WorldRecord {
    const rec = newWorldRecord("w-test", seed, 0);
    rec.queue.push(...tokens);
    for (let i = 1; i <= steps; i++) {
        closeWindow(rec, i * 20_000);
        openWindow(rec, i * 20_000);
    }
    return rec;
}

interface Hooks {
    envFill?: number;
    injectKnown?: (state: DriverState, k: number) => void;
}

function drive(rec: WorldRecord, h: Hooks = {}) {
    return replay(rec, W(), {
        envRng: baseEnvRng(h.envFill ?? 0.01),
        modelRng: () => greedy(),
        afterResolve: h.injectKnown,
    });
}

test("seats: initial four arms; queue FIFO births; AI rotation past the roster", () => {
    const st = drive(bootRecord(["tokA", "tokB", "tokC"], 5), { envFill: QUIET });
    expect([...st.seatArm.slice(0, 4)]).toEqual([0, 1, 2, 3]); // a/b/c/d 各一
    expect(st.tokenSlot.get("tokA")).toBe(4); // 刻 1 出生（FIFO 队首）
    expect(st.tokenSlot.get("tokB")).toBe(5);
    expect(st.tokenSlot.get("tokC")).toBe(6);
    expect(st.seatArm[7]).toBe(0); // 刻 4：花名册尽 → 轮替回 a_classic
    expect(st.seatArm[8]).toBe(1); // 刻 5 → b_terminal
    expect(st.queue).toEqual([]);
    expect(st.resolvedTicks).toBe(5);
});

test("join ordinal: mid-joined token is not popped at earlier historical births", () => {
    // 幻影配对缺陷（评审轮暴露 2026-10-14）：花名册须记加入时刻（已发生出生数），
    // 否则全量重演会把中途加入者配到更早的历史出生席（劫持 AI 席位）。
    const rec = bootRecord(["tokA"], 3); // 刻 1-3 结算（三次出生）
    rec.joinedAt["tokA"] = 2; // tokA 在两次出生之后加入 → 只应吃第三次出生
    const st = drive(rec, { envFill: QUIET });
    expect(st.tokenSlot.get("tokA")).toBe(6); // 第三次出生 = slot 6（4、5 归 AI 轮替）
    expect(st.seatArm[4]).toBe(0); // 初始四臂后的第一次轮替
    expect(st.seatArm[5]).toBe(1);
    expect(st.seatArm[6]).toBe(-1); // 人类席
});

test("reuse: reborn civ re-detected gets a fresh contact (perception caches dropped at death)", () => {
    // 槽复用的感知配套：slot 0 死亡（log.dark）时 prevKnown/prevObserved/frozenIntel
    // 须一并弃——否则复用后的新主被重探测时被 prevKnown 吞掉 contact 日志。
    // 实验路径（无复用）零变化：死后同槽不可能再被探测。
    const rec = bootRecord(["tokA"], 5);
    rec.ticks[1].nextActions["4"] = [4, 0]; // 窗 2 → 刻 3 STRIKE slot 0
    // fill 0.1：压制一切自然探测（tech-9 玩家截面 0.09 < 0.1）——contacts 只数注入的
    const st = replay(rec, W(), {
        envRng: baseEnvRng(0.1),
        modelRng: () => greedy(),
        afterResolve: (s, k) => {
            const env = s.env;
            if (k === 2) {
                env.known[4 * 36 + 0] = 1; // 玩家知 slot 0
                env.tech[4] = 9; // STRIKE 门 tech>7（p=0.95 > 掷 0.05 → 必杀）
            }
            if (k === 3) {
                // 刻 3 结算：slot 0 已死。手工耗尽未生槽（7..35 已生标记）+ 池，
                // 使刻 4 的出生复用 slot 0（最靠前已死槽；4 伪装在世）。
                for (let i = 7; i < 36; i++) env.spawn_tick[i] = 1;
                env.spawn_tick[4] = 4; // 已生（tick 1 出生的 tokA 席）
                env.spawn_tick[5] = 2; // 已生（tick 2 AI 席）
                env.spawn_tick[6] = 3; // 已生（tick 3 AI 席）
                env.free_pool = 20;
                env.pending_spawns[0] = 12.5;
            }
            if (k === 5) {
                // 刻 4 结算：复用已发生（slot 0 重生，known 列清空——刻 4 的
                // tracker 更新观察到 known 复位 → ⑥b 驱逐缓存）。真实流程中
                // 探测阶段先于出生阶段，重探测恒晚复用至少一刻——k=5 注入模拟之。
                env.known[4 * 36 + 0] = 1;
            }
        },
    });
    const log = st.runtimes.get("tokA")!.view!.log;
    expect(log.some((e) => e.key === "log.dark")).toBe(true); // slot 0 死亡可见
    const contacts = log.filter((e) => e.key === "log.contact");
    expect(contacts.length).toBe(2); // 修复前 1（重探测被 prevKnown 吞）；修复后 2
    // 复用断言：slot 0 重生
    expect(st.env.alive[0]).toBe(1);
    expect(st.env.spawn_tick[0]).toBe(4); // 复用出生记 t+1=4（刻 4 结算时 env.t=3）
});

test("same-tick death does not reuse the dead slot (death survives; no phantom runtime)", () => {
    // 轮次 2 评审 Critical #2：复用候选扫描在 resolve 阶段 10——本刻刚死的槽已
    // alive=0，若恰为最小已死槽且池够（尸体刚入池），同刻即复用：死因被 reuseSlot
    // 抹空、driver processDeaths 读到新住客 alive=1 → 死者 end 永不置位（幻影
    // 席位共享），后续重演可致世界砖化。修复 = 出生扫描跳过同刻死者（deadNow）。
    const rec = bootRecord(["tokA", "tokB", "tokC"], 4);
    rec.ticks[1].nextActions["5"] = [6, 4]; // 窗 2 → 刻 3：tokB 入侵 tokA
    const st = drive(rec, {
        envFill: QUIET,
        injectKnown: (s, k) => {
            if (k === 2) {
                s.env.known[5 * 36 + 4] = 1; // tokB 知 tokA（入侵门）
                // 耗尽全部未生槽：6..35 伪装"已生在世"，tokA 的槽 4 成为唯一
                //（本刻将死的）最小已死槽；池 ≥ 预滚额 → 阶段 10 触发复用路径
                for (let i = 6; i < 36; i++) {
                    s.env.spawn_tick[i] = 1;
                    s.env.alive[i] = 1;
                }
                s.env.free_pool = 20;
                s.env.pending_spawns[0] = 12.5;
            }
        },
    });
    // tokA 死于刻 3 入侵（保原动作）；死亡幸存——end 经 died_this_tick 置位
    //（死因在刻 3 装配时完好），运行时冻结，不被同刻复用吞成幻影
    const endA = st.runtimes.get("tokA")!.host.end;
    expect(endA).toMatchObject({ kind: "dead", cause: "invade" });
    // 刻 3 无出生（复用被推迟一刻）；刻 4 复用 slot 4 → 队首 tokC 弹出入座
    const log = st.env.birth_log;
    expect(log.length).toBe(3); // 刻 1、2 出生 + 刻 4 复用
    expect(log[2][1]).toBe(4); // 复用槽 = 4
    expect(log[2][0]).toBe(4); // 复用发生在刻 4（非死亡同刻）
    expect(st.tokenSlot.get("tokC")).toBe(4);
    expect(st.runtimes.get("tokC")!.view!.self!.slot).toBe(4);
    // tokA 的运行时不被幻影共享：仍是自己的死亡终局
    expect(st.runtimes.get("tokA")!.host.playerSlot).toBe(4); // 档案保留
    expect(st.runtimes.get("tokA")!.frozen).toBe(true);
});

test("seats: births fewer than roster → leftover tokens stay queued", () => {
    const st = drive(bootRecord(["tokA", "tokB", "tokC", "tokD"], 2), { envFill: QUIET });
    expect(st.tokenSlot.get("tokA")).toBe(4);
    expect(st.tokenSlot.get("tokB")).toBe(5);
    expect(st.queue).toEqual(["tokC", "tokD"]);
    expect(st.tokenSlot.has("tokC")).toBe(false);
});

test("determinism: same record replays byte-identical", () => {
    const rec = bootRecord(["tokA", "tokB"], 6);
    rec.ticks[1].nextActions["4"] = [1, -1]; // 窗 2 → 刻 3 DEVELOP
    rec.ticks[3].nextActions["4"] = [0, -1]; // 窗 4 → 刻 5 SILENT
    const snap = (st: DriverState) =>
        JSON.stringify({
            q: st.queue,
            ts: [...st.tokenSlot],
            sa: [...st.seatArm],
            rt: st.resolvedTicks,
            re: st.aiRechoices,
            inv: [...st.inFlightInvaders],
            views: [...st.runtimes].map(([tok, r]) => [tok, r.view]),
        });
    expect(snap(drive(rec))).toBe(snap(drive(rec)));
});

test("unsubmitted human seats default to SILENT (§13)", () => {
    const st = drive(bootRecord(["tokA"], 4), { envFill: QUIET });
    expect(st.env.last_action[4]).toBe(0);
    expect(st.runtimes.get("tokA")!.host.phase).toBe("awaiting-action");
    expect(st.runtimes.get("tokA")!.view!.self!.slot).toBe(4);
});

test("human submission executes at its tick", () => {
    const rec = bootRecord(["tokA"], 5);
    rec.ticks[1].nextActions["4"] = [1, -1]; // 刻 3 执行 DEVELOP
    const st = drive(rec, { envFill: QUIET });
    expect(st.env.tech[4]).toBeCloseTo(1.05, 5); // 1.0 + 0.05·(1−1e-6)
    expect(st.env.last_action[4]).toBe(0); // 刻 4/5 未提交 → SILENT
});

test("downgradeStaleTarget: invade/reveal → SILENT; strike/observe → nearest fallback", () => {
    expect(downgradeStaleTarget(6, 3, true)).toEqual([6, 3]);
    expect(downgradeStaleTarget(3, 3, true)).toEqual([3, 3]);
    expect(downgradeStaleTarget(4, 3, true)).toEqual([4, 3]);
    expect(downgradeStaleTarget(6, 3, false)).toEqual([0, -1]);
    expect(downgradeStaleTarget(3, 3, false)).toEqual([0, -1]);
    expect(downgradeStaleTarget(4, 3, false)).toEqual([4, -1]);
    expect(downgradeStaleTarget(7, 3, false)).toEqual([7, -1]);
    expect(downgradeStaleTarget(1, -1, false)).toEqual([1, -1]); // 无目标动作原样
});

test("stale strike falls back to nearest known; stale invade downgrades to SILENT", () => {
    // tokA 刻 3 入侵 slot5（击杀）；刻 4 提交的 STRIKE 目标 slot5 已死 → 降级 -1 →
    // env 最近已知兜底打中 slot0（唯一在案的存活已知）；互为对照的 INVADE 过期目标 → SILENT
    const rec = bootRecord(["tokA", "tokB"], 4);
    rec.ticks[1].nextActions["4"] = [6, 5]; // 刻 3：INVADE slot5
    rec.ticks[2].nextActions["4"] = [4, 5]; // 刻 4：STRIKE 过期目标 slot5
    const st = drive(rec, {
        envFill: QUIET,
        injectKnown: (s, k) => {
            if (k === 2) {
                s.env.known[4 * 36 + 5] = 1;
                s.env.known[4 * 36 + 0] = 1;
                s.env.tech[4] = 9; // STRIKE 门 tech>7（同 solo 测试的接缝手法）
                s.env.res[5] = 12.5; // 第二内生出生的预滚值落在 fill（ScriptedRng 原样
                // 返回）→ 缴获断言需要可读基数；接缝注入（仅测试，守恒仅 info 报告）
            }
        },
    });
    expect(st.env.alive[5]).toBe(0); // 刻 3 入侵击杀
    expect(st.env.alive[0]).toBe(0); // 刻 4 打击兜底命中 slot0（p=0.95 > 掷 0.05）
    expect(st.env.death_cause[0]).toBe("strike");
    expect(st.env.last_action[4]).toBe(4); // 末刻 = 刻 4 = STRIKE（未被降级为 SILENT）
    expect(st.runtimes.get("tokA")!.kills).toBe(2);
    expect(st.runtimes.get("tokA")!.loot).toBeCloseTo(6.25, 10); // 0.5×12.5

    // 过期 INVADE：同场景但刻 4 提交 [6,5] → 降级 SILENT（无目标无兜底）
    const rec2 = bootRecord(["tokA", "tokB"], 4);
    rec2.ticks[1].nextActions["4"] = [6, 5];
    rec2.ticks[2].nextActions["4"] = [6, 5];
    const st2 = drive(rec2, {
        envFill: QUIET,
        injectKnown: (s, k) => {
            if (k === 2) {
                s.env.known[4 * 36 + 5] = 1;
                s.env.known[4 * 36 + 0] = 1;
            }
        },
    });
    expect(st2.env.alive[0]).toBe(1); // 未被波及
    expect(st2.env.last_action[4]).toBe(0); // 降级 SILENT
    expect(st2.runtimes.get("tokA")!.kills).toBe(1);
});

test("invaded human: recorded counter → mutual; absent or -1 → original stands", () => {
    const mk = (rechoice?: number) => {
        const rec = bootRecord(["tokA", "tokB"], 5);
        rec.ticks[1].nextActions["4"] = [6, 5]; // 刻 3：tokA 入侵 tokB
        if (rechoice !== undefined) rec.ticks[2].rechoices["5"] = rechoice; // 窗 3 → 刻 3 重选
        return rec;
    };
    const inject = (s: DriverState, k: number) => {
        if (k === 2) s.env.known[4 * 36 + 5] = 1;
    };
    const counter = drive(mk(6), { envFill: QUIET, injectKnown: inject });
    expect(counter.env.alive[4]).toBe(0);
    expect(counter.env.alive[5]).toBe(0);
    expect(counter.runtimes.get("tokA")!.host.end).toMatchObject({ kind: "dead", cause: "mutual" });
    expect(counter.runtimes.get("tokA")!.frozen).toBe(true); // 死亡视图已渲染后冻结

    for (const variant of [undefined, -1] as const) {
        const expire = drive(mk(variant), { envFill: QUIET, injectKnown: inject });
        expect(expire.env.alive[5]).toBe(0); // 保原动作（SILENT）→ 死于入侵
        expect(expire.env.alive[4]).toBe(1);
        expect(expire.runtimes.get("tokB")!.host.end).toMatchObject({
            kind: "dead",
            cause: "invade",
        });
        expect(expire.runtimes.get("tokB")!.view!.end!.kind).toBe("dead");
    }
});

test("open window: in-flight invade exposes invader in the victim's view at env.t+1", () => {
    const rec = bootRecord(["tokA", "tokB"], 2); // 刻 1,2 结算；刻 3 飞行中
    rec.ticks[1].nextActions["4"] = [6, 5];
    const st = drive(rec, {
        envFill: QUIET,
        injectKnown: (s, k) => {
            if (k === 2) s.env.known[4 * 36 + 5] = 1;
        },
    });
    expect(st.resolvedTicks).toBe(2);
    expect(st.inFlightInvaders.get(5)).toBe(4);
    const vb = st.runtimes.get("tokB")!;
    expect(vb.host.phase).toBe("awaiting-rechoice");
    expect(vb.host.pendingInvader).toBe(4);
    expect(vb.view!.invasion).toEqual({ invaderId: 4 });
    const invaded = vb.view!.log.find((e) => e.key === "log.invaded");
    expect(invaded?.tick).toBe(3); // env.t+1（§0.3：与同刻结算事件同刻号）
    const va = st.runtimes.get("tokA")!;
    expect(va.host.phase).toBe("awaiting-action");
    expect(va.view!.invasion).toBeNull();
});

test("AI victims rechoose immediately via their arm policy", () => {
    const rec = bootRecord(["tokA"], 4);
    rec.ticks[1].nextActions["4"] = [6, 0]; // 刻 3：入侵 slot0（a_classic）
    const st = drive(rec, {
        envFill: QUIET,
        injectKnown: (s, k) => {
            if (k === 2) s.env.known[4 * 36 + 0] = 1;
        },
    });
    expect(st.aiRechoices).toBe(1);
    expect(st.env.alive[0]).toBe(0); // 重选为 6=互毁或其余=死于入侵——slot0 必死
});

test("AI one-choice basis = window-start snapshot (stash), not beginTick state", () => {
    // 确定性判别器（网值翻转发散不可靠——四臂 greedy 对 +1 公开文明不敏感，实测
    // 2026-10-12）：T(4) 清空 slot3(d_malintent) 的全部知识。
    // a₅ 已于 T(3) 算定（d 仍知情 → BOTHER=3 入 stash）→ 刻 5 执行选择原样（其
    // 目标掩码在 T(4) 已空 → env 降级执行——选择与执行分离恰可观察）；
    // a₆ 于 T(4) 扰动后计算 → BOTHER 已非法（valid 掩码论证）→ 刻 6 必 ≠ 3。
    // 若实现错为 beginTick 现算，stash 基线即变 4 且刻 5 的选择即反映扰动。
    const seen: { basis: number; slot3: number }[] = [];
    const run = (steps: number) => {
        seen.length = 0;
        return replay(bootRecord(["tokA"], steps), W(), {
            envRng: baseEnvRng(QUIET),
            modelRng: () => greedy(),
            afterResolve: (s, k) => {
                if (k === 4) {
                    seen.push({
                        basis: s.stashBasisTick,
                        slot3: s.stash ? s.stash[3] : -1,
                    });
                    for (let j = 0; j < s.env.n; j++) s.env.known[3 * s.env.n + j] = 0;
                }
            },
        });
    };
    const st5 = run(5);
    // T(4) 时手上的 stash = a₅：基线刻 3（上一边界算定），d 的选择仍是 BOTHER
    expect(seen[0]).toEqual({ basis: 3, slot3: 3 });
    // 刻 5 执行 = 预算的 a₅：slot0/1/2 不受扰动（ DEVELOP/SILENT 无目标门）
    const at5 = Array.from(st5.env.last_action.subarray(0, 4));
    expect([at5[0], at5[1], at5[2]]).toEqual([1, 0, 1]);
    // 刻 6：a₆ 基线含扰动 → BOTHER 非法 → 必翻转
    expect(run(6).env.last_action[3]).not.toBe(3);
});
