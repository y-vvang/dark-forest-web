import { expect, test } from "bun:test";

import { V23_CONFIG } from "./config";
import { N_ACTIONS, NEAR_K, OBS_DIM } from "./types";

test("V23_CONFIG matches config_v23.yaml env section", () => {
    expect(V23_CONFIG).toEqual({
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
        techSpawnLo: 0.5,
        techSpawnHi: 10.0,
        killBase: 0.55,
        killTechSlope: 0.12,
        resMin: 5.0,
        resMax: 20.0,
        resTotalBudget: 150.0,
        shieldCostFrac: 0.5,
        softsignA: 0.2,
        softsignRewardScale: 0.01,
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
    expect(N_ACTIONS).toBe(10);
    expect(NEAR_K).toBe(3);
    expect(OBS_DIM).toBe(38);
});
