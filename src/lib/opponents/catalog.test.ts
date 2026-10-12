import { expect, test } from "bun:test";

import { MODEL_CATALOG, OPPONENTS, PRESET_IDS, isModelId, isOpponentId } from "./catalog";

test("catalog: merged list = 3 presets + 4 v2.4 arms, presets first (user 2026-10-10)", () => {
    expect(OPPONENTS).toHaveLength(7);
    expect(OPPONENTS.slice(0, 3).map((o) => o.id)).toEqual([...PRESET_IDS]);
    expect(MODEL_CATALOG.map((m) => m.id)).toEqual(["a_classic", "b_terminal", "c_res", "d_malintent"]);
    for (const m of MODEL_CATALOG) {
        expect(m.file).toBe(`/models/${m.id}.json`);
        expect(m.meta).toBe("600ep · seed 42");
    }
    // v2.4 奖励臂 override 读数（与 V24_ARMS 同源，无 survival 字段——画像走 i18n）
    expect(MODEL_CATALOG.map((m) => m.override)).toEqual([
        "soft 0.01 · bd 0.5",
        "soft 0 · bd 0",
        "soft 0.01 · bd 0.5 · +res 0.0025",
        "soft 0.01 · bd 0.5 · +res 0.0025 · +attack 0.5",
    ]);
    expect(MODEL_CATALOG.every((m) => !("survival" in m))).toBe(true);
});

test("isOpponentId / isModelId", () => {
    for (const id of ["random", "df", "pacifist", "a_classic", "b_terminal", "c_res", "d_malintent"])
        expect(isOpponentId(id)).toBe(true);
    expect(isOpponentId("main")).toBe(false); // v2.3 主模型已退役
    expect(isOpponentId("base_control")).toBe(false); // 12 sweep 臂已退役
    for (const id of ["a_classic", "b_terminal", "c_res", "d_malintent"]) expect(isModelId(id)).toBe(true);
    for (const id of ["random", "df", "pacifist"]) expect(isModelId(id)).toBe(false);
});
