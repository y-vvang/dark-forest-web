import { expect, test } from "bun:test";

import { safetyNetDelay } from "./use-online-world";

const NOW = 1_000_000;
const DEADLINE = NOW + 18_000; // 窗口还剩 18s

test("arms once per tick: repeat calls after firing are suppressed", () => {
    // 走查回归（2026-10-28）：安全网失控循环——effect 每渲染重排（session 对象
    // 恒新）+ setLastAction 恒新对象触发重渲染 + setTimeout(0) 即发即忘 POST
    // ⇒ 无界请求风暴（dev 下 ERR_INSUFFICIENT_RESOURCES / lock busy 500 刷屏）。
    const base = {
        nowMs: DEADLINE, // 恰在触发点：delay=0
        tickEndsAtMs: DEADLINE,
        tick: 7,
        submission: null,
        canAct: true,
        stance: "develop" as const,
        firedTick: -1,
    };
    expect(safetyNetDelay(base)).toBe(0); // 首次：立即发
    // 响应未落地（submission 仍 null）时再次评估——必须被刻号闸挡住
    expect(safetyNetDelay({ ...base, firedTick: 7 })).toBeNull();
    expect(safetyNetDelay({ ...base, firedTick: 7, nowMs: DEADLINE + 500 })).toBeNull();
});

test("re-arms for the next tick after the window rolls", () => {
    const fired = { nowMs: NOW, tickEndsAtMs: DEADLINE, tick: 7, submission: null, canAct: true, stance: "develop" as const, firedTick: 7 };
    expect(safetyNetDelay(fired)).toBeNull(); // 同刻已发——仍被闸挡
    // 新窗口：tick=8、新截止 → 重新武装
    expect(safetyNetDelay({ ...fired, tick: 8, tickEndsAtMs: DEADLINE + 20_000, firedTick: 7 })).toBe(
        DEADLINE + 20_000 - NOW - 2000,
    );
});

test("does not arm when suppressed: silent stance / submitted / cannot act / no deadline", () => {
    const base = { nowMs: NOW, tickEndsAtMs: DEADLINE, tick: 7, canAct: true, firedTick: -1 };
    expect(safetyNetDelay({ ...base, stance: "silent" as const, submission: null })).toBeNull(); // 服务端缺省即静默
    expect(safetyNetDelay({ ...base, stance: "develop" as const, submission: { action: 1, target: -1 } })).toBeNull();
    expect(safetyNetDelay({ ...base, stance: "develop" as const, submission: null, canAct: false })).toBeNull();
    expect(safetyNetDelay({ ...base, stance: "develop" as const, submission: null, tickEndsAtMs: null as unknown as number })).toBeNull();
});

test("delay clamps at zero and stays accurate across re-arms", () => {
    const base = { tick: 7, submission: null, canAct: true, stance: "develop" as const, firedTick: -1, tickEndsAtMs: DEADLINE };
    expect(safetyNetDelay({ ...base, nowMs: DEADLINE - 5000 })).toBe(3000);
    expect(safetyNetDelay({ ...base, nowMs: DEADLINE + 100 })).toBe(0); // 过点钳 0（单发即止）
});
