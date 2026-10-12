import { expect, test } from "bun:test";

import { V24_CONFIG } from "@/lib/engine/config";
import { ARM_IDS, armParamsOf, emptyIngredients, partsOf, rewardOf } from "./rewards";

test("armParamsOf: V24_CONFIG + arm override (single source of truth)", () => {
    expect(armParamsOf("a_classic")).toEqual(V24_CONFIG);
    expect(armParamsOf("b_terminal").softsignRewardScale).toBe(0);
    expect(armParamsOf("b_terminal").bdEntryPenalty).toBe(0);
    expect(armParamsOf("c_res").resRewardScale).toBe(0.0025);
    expect(armParamsOf("d_malintent").attackReward).toBe(0.5);
    expect(armParamsOf("d_malintent").resRewardScale).toBe(0.0025);
    expect(armParamsOf("d_malintent").deathPenalty).toBe(10); // 全臂一致的死亡罚继承默认
    expect(() => armParamsOf("main")).toThrow(); // v2.3 臂已退役
    expect([...ARM_IDS]).toEqual(["a_classic", "b_terminal", "c_res", "d_malintent"]);
});

test("rewardOf: mirrors env2_v24 reward composition (develop/res/attack/bd/death)", () => {
    // 单刻发展（techTerm=2.5、res=12.5）+ 揭露一次 + 入域 + 死亡
    const ing = { techTerm: 2.5, resAtReward: 12.5, attackCount: 1, bdEnter: 1, death: 1 };
    const d = rewardOf(ing, {
        deathPenalty: 10,
        softsignRewardScale: 0.01,
        resRewardScale: 0.0025,
        attackReward: 0.5,
        bdEntryPenalty: 0.5,
    });
    expect(d).toBeCloseTo(-10 + 0.01 * 2.5 + 0.0025 * 12.5 + 0.5 - 0.5, 15);
    // b 臂：soft/bd 归零
    const b = rewardOf(ing, {
        deathPenalty: 10,
        softsignRewardScale: 0,
        resRewardScale: 0,
        attackReward: 0,
        bdEntryPenalty: 0,
    });
    expect(b).toBe(-10);
    // res 津贴 >0 才加（env2_v24.py:628 条件照抄）
    const noRes = rewardOf(
        { techTerm: 0, resAtReward: 12.5, attackCount: 0, bdEnter: 0, death: 0 },
        { deathPenalty: 10, softsignRewardScale: 0, resRewardScale: 0, attackReward: 0, bdEntryPenalty: 0.5 },
    );
    expect(noRes).toBe(0);
});

test("partsOf: component breakdown sums to rewardOf", () => {
    const ing = { techTerm: 3, resAtReward: 15, attackCount: 2, bdEnter: 1, death: 0 };
    const params = V24_CONFIG;
    const parts = partsOf(ing, params);
    const sum = parts.stipend + parts.res + parts.bounty + parts.bdEntry + parts.death;
    expect(sum).toBeCloseTo(rewardOf(ing, params), 15);
    expect(parts.bdEntry).toBe(-0.5);
    expect(emptyIngredients()).toEqual({ techTerm: 0, resAtReward: 0, attackCount: 0, bdEnter: 0, death: 0 });
});
