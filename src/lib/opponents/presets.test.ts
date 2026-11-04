import { expect, test } from "bun:test";

import { ScriptedRng } from "@/lib/engine/rng";
import { heuristicAction, pickTarget, type PresetState } from "./presets";

const PLAIN: PresetState = { underAttack: false, public: false, inDomain: false, lastInvader: -1 };
const BITTEN: PresetState = { ...PLAIN, underAttack: true, lastInvader: 2 };
const EXPOSED: PresetState = { ...PLAIN, public: true };
const SEALED: PresetState = { ...PLAIN, inDomain: true };

test("random: uniform among valid actions incl BOTHER (stage_b_v25b.py:53-55)", () => {
    const valid = new Uint8Array(8);
    valid[0] = 1;
    valid[3] = 1;
    const rng = new ScriptedRng([3], 0.5); // choice 原样返回脚本值——揭露可被选中
    expect(heuristicAction("random", valid, rng, PLAIN)).toBe(3);
});

test("df: STRIKE first (zero rng), then 30% OBSERVE, then 60% DEVELOP else SILENT (stage_b_v25b.py:56-63)", () => {
    const both = new Uint8Array(8);
    both[4] = 1;
    both[7] = 1;
    const r1 = new ScriptedRng([], 0.5);
    const before = r1.consumed;
    expect(heuristicAction("df", both, r1, PLAIN)).toBe(4); // 能打必打，不耗 rng
    expect(r1.consumed).toBe(before);
    const r2 = new ScriptedRng([0.2], 0.5); // 打击【不】合法才可能走观测分支
    const obsOnly = new Uint8Array(8);
    obsOnly[7] = 1;
    obsOnly[1] = 1;
    obsOnly[0] = 1;
    expect(heuristicAction("df", obsOnly, r2, PLAIN)).toBe(7); // 0.2 < 0.3 → OBSERVE
    const r3 = new ScriptedRng([0.9, 0.5], 0.5); // 观测分支未中 → 0.9；发展分支 0.5<0.6 → DEVELOP
    expect(heuristicAction("df", obsOnly, r3, PLAIN)).toBe(1);
    const none = new Uint8Array(8); // 打击/观测皆禁
    none[0] = 1;
    none[1] = 1;
    const r4 = new ScriptedRng([0.7], 0.5); // 0.7 ≥ 0.6 → SILENT
    expect(heuristicAction("df", none, r4, PLAIN)).toBe(0);
    const r5 = new ScriptedRng([0.7], 0.5); // OBSERVE 不合法 → 短路不掷（python `and` 同语义）
    expect(heuristicAction("df", none, r5, PLAIN)).toBe(0);
    expect(r5.consumed).toBe(1); // 仅 60% 分支消耗一次掷
});

test("df v2b: under_attack → INVADE counter-bite (zero rng, skips the 0.6 draw)", () => {
    const valid = new Uint8Array(8);
    valid[0] = 1;
    valid[1] = 1;
    valid[6] = 1; // SILENT/DEVELOP/INVADE 合法（无 STRIKE/OBSERVE）
    const rng = new ScriptedRng([], 0.5);
    const before = rng.consumed;
    expect(heuristicAction("df", valid, rng, BITTEN)).toBe(6); // 反咬一选
    expect(rng.consumed).toBe(before); // 零 rng（跳过 0.6 抽签）
    // last_invader < 0 → 不反咬，回落 0.6 抽签
    const rng2 = new ScriptedRng([0.5], 0.5);
    expect(heuristicAction("df", valid, rng2, { ...BITTEN, lastInvader: -1 })).toBe(1);
    expect(rng2.consumed).toBe(1);
    // INVADE 不合法（无已知目标）→ 不反咬
    const noInvade = new Uint8Array(8);
    noInvade[0] = 1;
    noInvade[1] = 1;
    const rng3 = new ScriptedRng([0.5], 0.5);
    expect(heuristicAction("df", noInvade, rng3, BITTEN)).toBe(1);
    expect(rng3.consumed).toBe(1);
});

test("pacifist v2b: hides under threat — BD when gated, SILENT otherwise (zero rng)", () => {
    const valid = new Uint8Array(8).fill(1);
    const rng = new ScriptedRng([], 0.5);
    const before = rng.consumed;
    expect(heuristicAction("pacifist", valid, rng, EXPOSED)).toBe(5); // public → BD
    expect(heuristicAction("pacifist", valid, rng, BITTEN)).toBe(5); // under_attack → BD
    expect(rng.consumed).toBe(before); // 藏匿路径零 rng（跳过 0.5 抽签）
    // BD 门不过（tech≤5）→ 静默
    const noBd = new Uint8Array(8);
    noBd[0] = 1;
    noBd[1] = 1;
    expect(heuristicAction("pacifist", noBd, rng, EXPOSED)).toBe(0);
    // 已在域 → 恒静默（BD 重声明无效）
    expect(heuristicAction("pacifist", valid, rng, SEALED)).toBe(0);
    // 未受威胁：v2.4 口径 50/50 不变
    const rng2 = new ScriptedRng([0.3, 0.9], 0.5);
    expect(heuristicAction("pacifist", valid, rng2, PLAIN)).toBe(1);
    expect(heuristicAction("pacifist", valid, rng2, PLAIN)).toBe(0);
});

test("pickTarget v2b: df counter-bites last_invader when in candidates; weakest/strongest otherwise (stage_b_v25b.py:35-49)", () => {
    const tech = Float64Array.from([9, 5, 3, 9.5, 0, 0, 0, 0, 0, 0, 7, 8, 9, 2, 3, 1]);
    const cand = [1, 2, 3]; // tech 5, 3, 9.5
    const rng = new ScriptedRng([2], 0.5);
    // 反咬优先于"最弱"：last_invader=1（tech 5）≠ 最弱 2（tech 3）——区分两分支
    expect(pickTarget("df", cand, tech, 6 /* INVADE */, rng, { ...PLAIN, underAttack: true, lastInvader: 1 })).toBe(1);
    expect(rng.consumed).toBe(0); // 反咬分支不耗 rng
    // last_invader 不在候选 → 回落最弱
    expect(pickTarget("df", cand, tech, 6, rng, { ...PLAIN, underAttack: true, lastInvader: 7 })).toBe(2);
    // 未被咬 → 常规最弱/最强
    expect(pickTarget("df", cand, tech, 6, rng, PLAIN)).toBe(2); // 最弱
    expect(pickTarget("df", cand, tech, 4 /* STRIKE */, rng, PLAIN)).toBe(3); // 最强
    expect(pickTarget("df", cand, tech, 3 /* BOTHER */, rng, PLAIN)).toBe(3); // 非入侵一律最强
    expect(pickTarget("df", cand, tech, 7 /* OBSERVE */, rng, PLAIN)).toBe(3);
    const rng2 = new ScriptedRng([1], 0.5);
    expect(pickTarget("random", cand, tech, 4, rng2, PLAIN)).toBe(1); // 原样 = 被选候选
    expect(pickTarget("model", cand, tech, 6, rng2, PLAIN)).toBe(2); // 下一脚本值 2
    // cand 顺序无关最强者 + 平手取先
    expect(pickTarget("df", [3, 1, 2], tech, 4, rng, PLAIN)).toBe(3); // 最大 9.5 = slot 3（cand[0]）
    const techTie = Float64Array.from([9, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pickTarget("df", [1, 2, 3], techTie, 6, rng, PLAIN)).toBe(1); // 全 5 → argmin 取先
});
