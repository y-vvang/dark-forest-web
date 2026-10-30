import { expect, test } from "bun:test";

import { HEARTBEAT_FACTOR, TICK_SECONDS } from "./config";
import {
    assertRecordSize,
    closeWindow,
    currentDeadline,
    inFlightTick,
    newWorldRecord,
    openWindow,
    pruneQueue,
    resolvedTickCount,
} from "./record";

const CUTOFF = HEARTBEAT_FACTOR * TICK_SECONDS * 1000;

test("new world record opens window 1 at spawn", () => {
    const now = 1_000_000;
    const rec = newWorldRecord("w1", 42, now);
    expect(rec.v).toBe(1);
    expect(rec.status).toBe("running");
    expect(rec.tickSeconds).toBe(TICK_SECONDS);
    expect(rec.queue).toEqual([]);
    expect(rec.seats).toEqual({});
    expect(rec.ticks).toHaveLength(1);
    expect(rec.ticks[0].beganAtMs).toBe(now);
    expect(rec.ticks[0].endedAtMs).toBeNull();
    expect(resolvedTickCount(rec)).toBe(0);
    expect(inFlightTick(rec)).toBe(1);
    expect(currentDeadline(rec)).toBe(now + TICK_SECONDS * 1000);
});

test("window lifecycle: close removes deadline, open starts next, resolvedTicks advances", () => {
    const rec = newWorldRecord("w1", 42, 0);
    closeWindow(rec, 20_000);
    expect(() => currentDeadline(rec)).toThrow();
    expect(resolvedTickCount(rec)).toBe(1);
    expect(inFlightTick(rec)).toBe(2);
    openWindow(rec, 20_000);
    expect(currentDeadline(rec)).toBe(20_000 + TICK_SECONDS * 1000);
    expect(resolvedTickCount(rec)).toBe(1);
    closeWindow(rec, 40_000);
    openWindow(rec, 40_000);
    expect(resolvedTickCount(rec)).toBe(2);
    expect(inFlightTick(rec)).toBe(3);
});

test("closeWindow rejects when no open window", () => {
    const rec = newWorldRecord("w1", 42, 0);
    closeWindow(rec, 1);
    expect(() => closeWindow(rec, 2)).toThrow();
});

test("openWindow rejects while previous window still open", () => {
    const rec = newWorldRecord("w1", 42, 0);
    expect(() => openWindow(rec, 1)).toThrow();
});

test("pruneQueue drops stale/missing heartbeats, keeps order, returns removed", () => {
    const rec = newWorldRecord("w1", 42, 0);
    rec.queue = ["a", "b", "c", "d"];
    const now = 100_000;
    const removed = pruneQueue(
        rec,
        [
            now - CUTOFF - 1, // a：超阈 1ms → 剪
            now - CUTOFF, // b：恰好等于阈值 → 保留（严格大于才剪）
            null, // c：从未心跳 → 剪
            now, // d：新鲜 → 保留
        ],
        now,
    );
    expect(removed).toEqual(["a", "c"]);
    expect(rec.queue).toEqual(["b", "d"]);
});

test("pruneQueue never prunes seated tokens (FIFO pairing stability)", () => {
    const rec = newWorldRecord("w1", 42, 0);
    rec.queue = ["a", "b"];
    rec.seats["a"] = 4; // a 已入座——剪除会破坏 FIFO 配对重演
    expect(pruneQueue(rec, [null, null], 100_000)).toEqual(["b"]);
    expect(rec.queue).toEqual(["a"]);
});

test("record JSON round-trip preserves entries", () => {
    const rec = newWorldRecord("w1", 42, 0);
    rec.ticks[0].nextActions["7"] = [4, 12];
    rec.ticks[0].rechoices["7"] = 6;
    rec.queue = ["tok1"];
    rec.joinedAt["tok1"] = 3;
    rec.seats["tok1"] = 4;
    closeWindow(rec, 20_000);
    openWindow(rec, 20_000);
    const back = JSON.parse(JSON.stringify(rec)) as typeof rec;
    expect(back).toEqual(rec);
});

test("assertRecordSize returns byte size and warns past the target", () => {
    const rec = newWorldRecord("w1", 42, 0);
    expect(assertRecordSize(rec)).toBeLessThan(65_536);
    // 塞大：500 窗 × 每窗 8 个人类提交
    for (let i = 0; i < 500; i++) {
        closeWindow(rec, i * 1000);
        openWindow(rec, i * 1000);
        for (let s = 0; s < 8; s++)
            rec.ticks[rec.ticks.length - 1].nextActions[String(s)] = [4, s * 3];
    }
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
        expect(assertRecordSize(rec)).toBeGreaterThan(65_536);
    } finally {
        console.warn = orig;
    }
    expect(warns).toHaveLength(1);
});
