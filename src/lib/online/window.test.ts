import { expect, test } from "bun:test";

import { ScriptedRng, type Rng } from "@/lib/engine/rng";
import { getWeights } from "./ai";
import {
    replay,
    settleCurrent,
    sprintDue,
    type DriverState,
} from "./driver";
import { currentDeadline, newWorldRecord, closeWindow, openWindow, resolvedTickCount } from "./record";

// 配方同 driver.test.ts（自包含测试文件惯例）
function baseEnvRng(fill: number) {
    return new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5], fill);
}
const QUIET = 0.05;
const W = () => getWeights();
const greedy = (): Rng => new ScriptedRng([], 0.5);

function bootRecord(tokens: string[], steps: number, seed = 7) {
    const rec = newWorldRecord("w-test", seed, 0);
    rec.queue.push(...tokens);
    for (let i = 1; i <= steps; i++) {
        closeWindow(rec, i * 20_000);
        openWindow(rec, i * 20_000);
    }
    return rec;
}

function replay2(rec: ReturnType<typeof bootRecord>, inject?: (s: DriverState, k: number) => void) {
    return replay(rec, W(), {
        envRng: baseEnvRng(QUIET),
        modelRng: () => greedy(),
        afterResolve: inject,
    });
}

test("settleCurrent: resolves the in-flight tick; next window anchors at the settle time", () => {
    const rec = bootRecord(["tokA"], 2); // 刻 1,2 已结算；刻 3 飞行（窗 3 开）
    const st = replay2(rec);
    expect(st.resolvedTicks).toBe(2);
    const ended = settleCurrent(st, rec, 123_456); // 快进语义：nowMs = 结算时刻
    expect(ended).toBe(false);
    expect(resolvedTickCount(rec)).toBe(3);
    expect(currentDeadline(rec)).toBe(123_456 + 20_000); // 新窗截止 = now + 20s
    expect(st.resolvedTicks).toBe(3);
});

test("deadline catch-up settles at the scheduled deadline, keeping windows wall-anchored", () => {
    const rec = bootRecord(["tokA"], 2); // 窗 3 开于 40s → 截止 60s
    const st = replay2(rec);
    settleCurrent(st, rec, 60_000); // 追赶：锚"原截止"而非 now(=100s)
    expect(currentDeadline(rec)).toBe(80_000); // 60+20s——墙钟链不漂移
});

test("sprintDue: humans alive → never due, even when all submitted (AI first-class, full window)", () => {
    // 用户 2026-10-14 裁定：全员提交不再提前结算——AI 一等公民，每刻恒满 20s
    const rec = bootRecord(["tokA", "tokB"], 2); // 两者已出生；刻 3 飞行
    rec.ticks[2].nextActions["4"] = [6, 5]; // tokA 窗 3 提交入侵 → 刻 4 执行
    const st = replay2(rec, (s, k) => {
        if (k === 2) s.env.known[4 * 36 + 5] = 1;
    });
    settleCurrent(st, rec, 40_000); // 结算刻 3 → 刻 4 飞行：tokB 受害
    // 全员提交 + 受害者显式响应（-1）——旧行为 true（快进），现在恒 false
    const open = rec.ticks[rec.ticks.length - 1];
    open.nextActions["4"] = [0, -1];
    open.nextActions["5"] = [0, -1];
    open.rechoices["5"] = -1;
    expect(sprintDue(st, rec)).toBe(false);
});

test("sprintDue: zero humans — queue non-empty = deadline pace, empty = sprint", () => {
    const rec = bootRecord([], 2); // 无人类（空花名册）
    const st = replay2(rec);
    expect(sprintDue(st, rec)).toBe(true); // 无人类且队空 → 冲刺（无观察者清场）
    st.queue.push("ghost");
    expect(sprintDue(st, rec)).toBe(false); // 队列非空 → 20s 节奏（等出生）
});
test("rechoice expiry: deadline settle without rechoices keeps the original action", () => {
    const rec = bootRecord(["tokA", "tokB"], 2);
    rec.ticks[1].nextActions["4"] = [6, 5]; // 窗 2 提交 → 刻 3 执行入侵 tokB
    const st = replay2(rec, (s, k) => {
        if (k === 2) s.env.known[4 * 36 + 5] = 1;
    });
    expect(st.inFlightInvaders.get(5)).toBe(4); // 刻 3 飞行中：tokB 受害（未响应）
    settleCurrent(st, rec, 60_000); // 到点结算刻 3——保原动作（SILENT）→ 死于入侵
    expect(st.env.alive[5]).toBe(0);
    expect(st.env.alive[4]).toBe(1);
    expect(st.runtimes.get("tokB")!.host.end).toMatchObject({ kind: "dead", cause: "invade" });
});

test("sprint: zero humans + empty queue chains settles to world end", () => {
    const rec = bootRecord([], 2);
    const st = replay2(rec);
    let settles = 0;
    let ended = false;
    while (!ended && settles < 300) {
        ended = settleCurrent(st, rec, 250 * 20_000);
        settles++;
    }
    expect(ended).toBe(true);
    expect(rec.status).toBe("ended");
    expect(rec.endedAtMs).toBe(250 * 20_000);
    expect(() => currentDeadline(rec)).toThrow(); // 全部关窗
});
