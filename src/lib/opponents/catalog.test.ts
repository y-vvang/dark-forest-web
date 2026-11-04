import { expect, test } from "bun:test";

import { MODEL_CATALOG, MODEL_IDS, OPPONENTS, PRESET_IDS, isModelId, isOpponentId } from "./catalog";

test("catalog: merged list = 3 presets + 4 v2.5 arms + champion, presets first (user 2026-10-10 + 2026-11-01)", () => {
    expect(OPPONENTS).toHaveLength(8);
    expect(OPPONENTS.slice(0, 3).map((o) => o.id)).toEqual([...PRESET_IDS]);
    expect(MODEL_CATALOG.map((m) => m.id)).toEqual([
        "a_classic",
        "b_terminal",
        "c_res",
        "d_malintent",
        "champion",
    ]);
    for (const m of MODEL_CATALOG.slice(0, 4)) {
        expect(m.file).toBe(`/models/${m.id}.json`);
        expect(m.meta).toBe("600ep · seed 42");
    }
    // v3.0 champion（league 1000ep，seed 42）——"见过所有策略家族的泛化体"
    const champ = MODEL_CATALOG[4];
    expect(champ.file).toBe("/models/champion.json");
    expect(champ.meta).toBe("1000ep league · seed 42");
    expect(champ.profile).toBe("opp.champion.desc");
    // v2.5 奖励臂 override 读数（与 V25_ARMS 同源）；champion 用 config_v25 缺省（经典参数）
    expect(MODEL_CATALOG.map((m) => m.override)).toEqual([
        "soft 0.01 · bd 0.5",
        "soft 0 · bd 0",
        "soft 0.01 · bd 0.5 · +res 0.0025",
        "soft 0.01 · bd 0.5 · +res 0.0025 · +attack 0.5",
        "soft 0.01 · bd 0.5",
    ]);
    expect(MODEL_CATALOG.every((m) => !("survival" in m))).toBe(true);
    expect(MODEL_IDS).toEqual(MODEL_CATALOG.map((m) => m.id)); // 参谋遍历源
});

test("isOpponentId / isModelId", () => {
    for (const id of ["random", "df", "pacifist", "a_classic", "b_terminal", "c_res", "d_malintent", "champion"])
        expect(isOpponentId(id)).toBe(true);
    expect(isOpponentId("main")).toBe(false); // v2.3 主模型已退役
    expect(isOpponentId("base_control")).toBe(false); // 12 sweep 臂已退役
    for (const id of ["a_classic", "b_terminal", "c_res", "d_malintent", "champion"])
        expect(isModelId(id)).toBe(true);
    for (const id of ["random", "df", "pacifist"]) expect(isModelId(id)).toBe(false);
});
