/**
 * v2.4 环境参数（权威：experiment/experiment/config_v24.yaml env 节，
 * 装配口径同 data2_v24.py:38-67）。数值零偏离——改动即违背一致性硬要求。
 * v2.4 vs v2.3-fix：techSpawnLo=Hi=1.0（禁科技继承，出生科技恒 1.0）+ 新增
 * resRewardScale/attackReward 两奖励臂参数（默认 0=关；四臂 override 见
 * runs/v24_arms/<arm>/config.yaml）。种子不经配置传递：Rng 在构造期注入
 * （见 rng.ts / game-mechanics.md §2.2）。
 */
export interface EnvConfig {
    nAgents: number;
    world: number;
    detectRadius: number;
    tMax: number;
    pDetectBase: number;
    stealthMult: number;
    pDetectMax: number;
    pExplosion: number;
    developRate: number;
    techCap: number;
    techSpawnLo: number;
    techSpawnHi: number;
    killBase: number;
    killTechSlope: number;
    resMin: number;
    resMax: number;
    pDeplete: number;
    depleteLo: number;
    depleteHi: number;
    gateBroadcastTech: number;
    gateBroadcastRes: number;
    gateObserveTech: number;
    gateDomainTech: number;
    gateStrikeTech: number;
    /** 历史参数：resolve() 不使用（奖励走 softsignRewardScale）——照抄以防未来误用 */
    developReward: number;
    deathPenalty: number;
    bdEntryPenalty: number;
    bdGrowthMult: number;
    bdExplosionMult: number;
    enableBlackDomain: boolean;
    /** [tick, count]——v2.4 恒 [[0, 4]]：初始 4 席，此后全部内生出生 */
    spawnSchedule: [number, number][];
    resTotalBudget: number;
    shieldCostFrac: number;
    softsignA: number;
    softsignRewardScale: number;
    /** v2.4 奖励臂：DEVELOP 刻 + scale·res（默认 0=关） */
    resRewardScale: number;
    /** v2.4 奖励臂：打击击杀/入侵缴获/揭露目标 各 +attack（默认 0=关） */
    attackReward: number;
}

export const V24_CONFIG: EnvConfig = {
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
    resTotalBudget: 150.0,
    shieldCostFrac: 0.5,
    softsignA: 0.2,
    softsignRewardScale: 0.01,
    resRewardScale: 0.0,
    attackReward: 0.0,
};

/**
 * v2.4 四奖励臂的环境参数 override（权威：experiment/runs/v24_arms/<arm>/config.yaml
 * env 节）。游戏层奖励展示/开局配置的臂预设共用此表。
 */
export const V24_ARMS: Record<string, Partial<EnvConfig>> = {
    a_classic: {},
    b_terminal: { softsignRewardScale: 0.0, bdEntryPenalty: 0.0 },
    c_res: { resRewardScale: 0.0025 },
    d_malintent: { resRewardScale: 0.0025, attackReward: 0.5 },
};
