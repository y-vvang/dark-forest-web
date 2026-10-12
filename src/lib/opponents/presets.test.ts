import { expect, test } from "bun:test";

import { ScriptedRng } from "@/lib/engine/rng";
import { heuristicAction, pickTarget } from "./presets";

test("random: uniform among valid actions incl BOTHER (train2_v24.py:42-43)", () => {
    const valid = new Uint8Array(8);
    valid[0] = 1;
    valid[3] = 1;
    const rng = new ScriptedRng([3], 0.5); // choice 原样返回脚本值——v2.4 揭露可被选中
    expect(heuristicAction("random", valid, rng)).toBe(3);
});

test("df: STRIKE first (zero rng), then 30% OBSERVE, then 60% DEVELOP else SILENT (train2_v24.py:45-49)", () => {
    const both = new Uint8Array(8);
    both[4] = 1;
    both[7] = 1;
    const r1 = new ScriptedRng([], 0.5);
    const before = r1.consumed;
    expect(heuristicAction("df", both, r1)).toBe(4); // 能打必打，不耗 rng
    expect(r1.consumed).toBe(before);
    const r2 = new ScriptedRng([0.2], 0.5); // 打击【不】合法才可能走观测分支
    const obsOnly = new Uint8Array(8);
    obsOnly[7] = 1;
    obsOnly[1] = 1;
    obsOnly[0] = 1;
    expect(heuristicAction("df", obsOnly, r2)).toBe(7); // 0.2 < 0.3 → OBSERVE
    const r3 = new ScriptedRng([0.9, 0.5], 0.5); // 观测分支未中 → 0.9；发展分支 0.5<0.6 → DEVELOP
    expect(heuristicAction("df", obsOnly, r3)).toBe(1);
    const none = new Uint8Array(8); // 打击/观测皆禁
    none[0] = 1;
    none[1] = 1;
    const r4 = new ScriptedRng([0.7], 0.5); // 0.7 ≥ 0.6 → SILENT
    expect(heuristicAction("df", none, r4)).toBe(0);
    const r5 = new ScriptedRng([0.7], 0.5); // OBSERVE 不合法 → 短路不掷（python `and` 同语义）→ 0.7 ≥ 0.6 → SILENT
    expect(heuristicAction("df", none, r5)).toBe(0);
    expect(r5.consumed).toBe(1); // 仅 60% 分支消耗一次掷
});

test("pacifist: 50/50 DEVELOP/SILENT, never attacks (train2_v24.py:50-51)", () => {
    const rng = new ScriptedRng([0.3, 0.9], 0.5);
    const valid = new Uint8Array(8).fill(1);
    expect(heuristicAction("pacifist", valid, rng)).toBe(1); // 0.3 < 0.5
    expect(heuristicAction("pacifist", valid, rng)).toBe(0); // 0.9 ≥ 0.5
});

test("pickTarget: df invades weakest / others strongest; random & model uniform (stage_b_v24.py:48-52)", () => {
    const tech = Float64Array.from([9, 5, 3, 9.5, 0, 0, 0, 0, 0, 0, 7, 8, 9, 2, 3, 1]);
    const cand = [1, 2, 3]; // tech 5, 3, 9.5
    const rng = new ScriptedRng([2], 0.5);
    expect(pickTarget("df", cand, tech, 6 /* INVADE */, rng)).toBe(2); // 最弱
    expect(rng.consumed).toBe(0); // df 分支不耗 rng
    expect(pickTarget("df", cand, tech, 4 /* STRIKE */, rng)).toBe(3); // 最强
    expect(pickTarget("df", cand, tech, 3 /* BOTHER 揭露 */, rng)).toBe(3); // 非入侵一律最强（"诅咒领跑者"）
    expect(pickTarget("df", cand, tech, 7 /* OBSERVE */, rng)).toBe(3);
    const rng2 = new ScriptedRng([1], 0.5);
    expect(pickTarget("random", cand, tech, 4, rng2)).toBe(1); // 原样 = 被选候选
    expect(pickTarget("model", cand, tech, 6, rng2)).toBe(2); // 下一脚本值 2
    // cand 顺序无关最强者 + 平手取先
    expect(pickTarget("df", [3, 1, 2], tech, 4, rng)).toBe(3); // 最大 9.5 = slot 3（cand[0]）
    const techTie = Float64Array.from([9, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pickTarget("df", [1, 2, 3], techTie, 6, rng)).toBe(1); // 全 5 → argmin 取先
});
