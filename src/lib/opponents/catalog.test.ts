import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { MODEL_CATALOG, PRESET_IDS, isOpponentId } from "./catalog";

test("catalog: 12 models, unique ids, files exist in public/models, survival from ai-opponents.md", () => {
    expect(MODEL_CATALOG).toHaveLength(12);
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(12);
    for (const m of MODEL_CATALOG) {
        expect(m.file).toBe(`/models/${m.id}.json`);
        expect(existsSync(`public/models/${m.id}.json`)).toBe(true);
        expect(m.survival).toBeGreaterThan(0);
        expect(m.survival).toBeLessThan(1);
    }
    const byId = Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m.survival]));
    expect(byId.main).toBe(0.627);
    expect(byId.shield025).toBe(0.775);
    expect(byId.shield075).toBe(0.613);
    expect(byId.scale005).toBe(0.747);
    expect(byId.scale02).toBe(0.612);
    expect(byId.budget100).toBe(0.683);
    expect(byId.budget200).toBe(0.707);
    expect(byId.lr3e4).toBe(0.618);
    expect(byId.lr12e3).toBe(0.522);
    expect(byId.gamma099).toBe(0.753);
    expect(byId.gamma0999).toBe(0.58);
    expect(byId.base_control).toBe(0.669);
    expect(MODEL_CATALOG[0].id).toBe("main");
    expect(MODEL_CATALOG[0].main).toBe(true);
});

test("catalog: presets + isOpponentId truth table", () => {
    expect(PRESET_IDS).toEqual(["random", "df", "pacifist"]);
    expect(isOpponentId("random")).toBe(true);
    expect(isOpponentId("main")).toBe(true);
    expect(isOpponentId("shield025")).toBe(true);
    expect(isOpponentId("nope")).toBe(false);
    expect(isOpponentId("")).toBe(false);
    expect(isOpponentId("learner")).toBe(false); // learner 不是可选 id——那是 stage_b 的席位角色
});
