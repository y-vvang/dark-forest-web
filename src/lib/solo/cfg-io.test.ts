import { expect, test } from "bun:test";

import { V24_CONFIG, type EnvConfig } from "@/lib/engine/config";
import { CFG_FIELDS, applyArmReward, clampValue, readEnvConfig, serializeConfigDiff } from "./cfg-io";

/** 构造受控 sessionStorage（bun test 无 window——模拟最小面） */
function fakeStorage(map: Record<string, string>): void {
    const g = globalThis as Record<string, unknown>;
    g.window = { sessionStorage: { getItem: (k: string) => map[k] ?? null } };
}
function clearFakeStorage(): void {
    delete (globalThis as Record<string, unknown>).window;
}

test("CFG_FIELDS: 25 curated knobs, all clamp inside V24_CONFIG defaults", () => {
    expect(CFG_FIELDS.length).toBe(25);
    expect(new Set(CFG_FIELDS.map((f) => f.key)).size).toBe(25);
    for (const f of CFG_FIELDS) {
        const d = V24_CONFIG[f.key as keyof EnvConfig] as number;
        expect(f.min, `${f.key}.min <= default`).toBeLessThanOrEqual(d);
        expect(f.max, `${f.key}.max >= default`).toBeGreaterThanOrEqual(d);
    }
});

test("serializeConfigDiff: only changed fields stored (compact keys)", () => {
    const cfg = { ...V24_CONFIG, tMax: 100, attackReward: 0.5 };
    const s = serializeConfigDiff(cfg);
    const o = JSON.parse(s) as Record<string, number>;
    expect(o).toEqual({ tMax: 100, attackReward: 0.5 });
});

test("readEnvConfig: absent/corrupt → default; unknown keys ignored; out-of-range clamped", () => {
    fakeStorage({});
    expect(readEnvConfig()).toEqual(V24_CONFIG);
    fakeStorage({ "df.env-cfg": "{oops" });
    expect(readEnvConfig()).toEqual(V24_CONFIG);
    fakeStorage({
        "df.env-cfg": JSON.stringify({ tMax: 99999, attackReward: -5, nAgents: 3, world: 5 }),
    });
    const cfg = readEnvConfig();
    expect(cfg.tMax).toBe(1000); // 钳到 max
    expect(cfg.attackReward).toBe(0); // 钳到 min
    expect(cfg.nAgents).toBe(36); // 未知键忽略（结构参数固定）
    expect(cfg.world).toBe(100);
    clearFakeStorage();
});

test("clampValue: round-trips defaults exactly", () => {
    for (const f of CFG_FIELDS) {
        const d = V24_CONFIG[f.key as keyof EnvConfig] as number;
        expect(clampValue(f, d)).toBe(d);
    }
});

test("applyArmReward: full five-param reset then arm override (default button uses a_classic)", () => {
    // 评审修复（2026-10-12 #3）：default 按钮曾漏 deathPenalty——applyArmReward 显式回默认五元组
    const cfg = { ...V24_CONFIG, deathPenalty: 100, attackReward: 2, resRewardScale: 0.02 };
    expect(applyArmReward(cfg, "a_classic")).toEqual(V24_CONFIG); // 全默认
    expect(applyArmReward(cfg, "a_classic").deathPenalty).toBe(10); // 明确锁死曾经的漏网键
    expect(applyArmReward(cfg, "b_terminal")).toEqual({ ...V24_CONFIG, softsignRewardScale: 0, bdEntryPenalty: 0 });
    expect(applyArmReward(cfg, "c_res")).toEqual({ ...V24_CONFIG, resRewardScale: 0.0025 });
    expect(applyArmReward(cfg, "d_malintent")).toEqual({
        ...V24_CONFIG,
        resRewardScale: 0.0025,
        attackReward: 0.5,
    });
    // 非 reward 字段不被动
    const cfg2 = { ...V24_CONFIG, tMax: 99 };
    expect(applyArmReward(cfg2, "b_terminal").tMax).toBe(99);
});
