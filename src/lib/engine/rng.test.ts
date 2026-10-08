import { expect, test } from "bun:test";

import { GameRng, ScriptedRng, seedOf } from "./rng";

test("GameRng deterministic + half-open", () => {
    const a = new GameRng([42]);
    const b = new GameRng([42]);
    const u = a.uniform();
    expect(u).toBe(b.uniform());
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    // 500 次采样全部落在 [0,1)
    for (let i = 0; i < 500; i++) {
        const v = a.uniform();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
    }
});

test("seedOf: stable per (seed, domain), distinct across domains", () => {
    expect(seedOf(42, "env")).toBe(seedOf(42, "env"));
    expect(seedOf(42, "env")).not.toBe(seedOf(42, "agent:0"));
    expect(seedOf(42, "model:main")).not.toBe(seedOf(43, "model:main"));
});

test("ScriptedRng pops queue verbatim then fill; counts consumption", () => {
    const r = new ScriptedRng([1, 2, 3, 4], 0.5);
    // 脚本值原样返回（不做 lo/hi 缩放——脚本的即终值，见 engine 测试约定）
    expect(r.uniformArray(2)).toEqual(new Float64Array([1, 2]));
    expect(r.choice([7, 8, 9])).toBe(3);
    expect(r.uniformRange(0, 100)).toBe(4); // 队列最后一个值（同样原样）
    expect(r.uniform()).toBe(0.5); // 队列尽 → fill
    expect(r.consumed).toBe(5);
});

test("ScriptedRng choice from fill indexes candidates deterministically", () => {
    const r = new ScriptedRng([], 0.5);
    expect(r.choice([7, 8, 9])).toBe(8); // floor(0.5*3)=1 → 8
});
