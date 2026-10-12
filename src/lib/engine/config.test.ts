import { expect, test } from "bun:test";

import { V24_ARMS, V24_CONFIG } from "./config";
import { N_ACTIONS, NEAR_K, OBS_DIM } from "./types";

test("V24_CONFIG matches config_v24.yaml env section", () => {
    expect(V24_CONFIG).toEqual({
        nAgents: 36,
        world: 100.0,
        detectRadius: 30.0,
        tMax: 250,
        pDetectBase: 0.03,
        stealthMult: 0.25,
        pDetectMax: 0.35,
        pExplosion: 0.01,
        developRate: 0.05,
        techCap: 1_000_000.0,
        techSpawnLo: 1.0,
        techSpawnHi: 1.0,
        killBase: 0.55,
        killTechSlope: 0.12,
        resMin: 5.0,
        resMax: 20.0,
        resTotalBudget: 150.0,
        shieldCostFrac: 0.5,
        softsignA: 0.2,
        softsignRewardScale: 0.01,
        resRewardScale: 0.0,
        attackReward: 0.0,
        pDeplete: 0.02,
        depleteLo: 0.5,
        depleteHi: 2.0,
        gateBroadcastTech: 1.0,
        gateBroadcastRes: 10.0,
        gateObserveTech: 5.0,
        gateDomainTech: 5.0,
        gateStrikeTech: 7.0,
        developReward: 0.05,
        deathPenalty: 10.0,
        bdEntryPenalty: 0.5,
        bdGrowthMult: 0.2,
        bdExplosionMult: 0.1,
        enableBlackDomain: true,
        spawnSchedule: [[0, 4]],
    });
    expect(N_ACTIONS).toBe(8);
    expect(NEAR_K).toBe(3);
    expect(OBS_DIM).toBe(36);
});

test("V24_ARMS match runs/v24_arms/<arm>/config.yaml reward overrides", () => {
    expect(V24_ARMS.a_classic).toEqual({});
    expect(V24_ARMS.b_terminal).toEqual({ softsignRewardScale: 0.0, bdEntryPenalty: 0.0 });
    expect(V24_ARMS.c_res).toEqual({ resRewardScale: 0.0025 });
    expect(V24_ARMS.d_malintent).toEqual({ resRewardScale: 0.0025, attackReward: 0.5 });
    for (const o of Object.values(V24_ARMS))
        for (const [k, v] of Object.entries(o)) expect(V24_CONFIG[k as keyof typeof V24_CONFIG]).not.toBe(v);
});
