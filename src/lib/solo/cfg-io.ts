/**
 * 环境常量配置 IO（用户 2026-10-10 需求：单人开局前可配置——精选参数）。
 *
 * 默认恒为 v2.4 权威 config_v24.yaml；任何改动 = 对实验的**明示偏离**（DESIGN.md
 * 披露条款）。序列化 = 相对 V24_CONFIG 的差集（只存改动字段）；读取端忽略未知键
 * （结构参数 nAgents/world/spawnSchedule 等不可配——模型观测缩放按默认训练）并
 * 把越界值钳回字段范围。字段标签 = 参数名 mono 读数（技术记号，非 i18n 文案——
 * 目录 arm id 先例）；分组标题与披露文案走 i18n。
 */
import { V24_ARMS, V24_CONFIG, type EnvConfig } from "@/lib/engine/config";

export interface CfgField {
    /** EnvConfig 数值字段名（mono 标签） */
    key: keyof EnvConfig;
    min: number;
    max: number;
    step: number;
    /** 分组（i18n 组名键） */
    group: "solo.config.g.clock" | "solo.config.g.detect" | "solo.config.g.econ" | "solo.config.g.tech" | "solo.config.g.force" | "solo.config.g.gates" | "solo.config.g.reward";
}

/** 精选 25 项（用户确认范围）：时长/探测/经济/科技/武力/门槛/奖励 */
export const CFG_FIELDS: CfgField[] = [
    { key: "tMax", min: 16, max: 1000, step: 1, group: "solo.config.g.clock" },
    { key: "detectRadius", min: 5, max: 60, step: 1, group: "solo.config.g.detect" },
    { key: "pDetectBase", min: 0, max: 0.2, step: 0.005, group: "solo.config.g.detect" },
    { key: "stealthMult", min: 0, max: 1, step: 0.05, group: "solo.config.g.detect" },
    { key: "pDetectMax", min: 0, max: 1, step: 0.05, group: "solo.config.g.detect" },
    { key: "resTotalBudget", min: 10, max: 1000, step: 5, group: "solo.config.g.econ" },
    { key: "resMin", min: 0.5, max: 50, step: 0.5, group: "solo.config.g.econ" },
    { key: "resMax", min: 1, max: 100, step: 1, group: "solo.config.g.econ" },
    { key: "pDeplete", min: 0, max: 1, step: 0.01, group: "solo.config.g.econ" },
    { key: "depleteLo", min: 0, max: 10, step: 0.1, group: "solo.config.g.econ" },
    { key: "depleteHi", min: 0, max: 10, step: 0.1, group: "solo.config.g.econ" },
    { key: "developRate", min: 0, max: 1, step: 0.01, group: "solo.config.g.tech" },
    { key: "pExplosion", min: 0, max: 0.2, step: 0.005, group: "solo.config.g.tech" },
    { key: "killBase", min: 0, max: 1, step: 0.05, group: "solo.config.g.force" },
    { key: "killTechSlope", min: 0, max: 2, step: 0.01, group: "solo.config.g.force" },
    { key: "gateStrikeTech", min: 0, max: 20, step: 0.5, group: "solo.config.g.gates" },
    { key: "gateObserveTech", min: 0, max: 20, step: 0.5, group: "solo.config.g.gates" },
    { key: "gateDomainTech", min: 0, max: 20, step: 0.5, group: "solo.config.g.gates" },
    { key: "gateBroadcastTech", min: 0, max: 20, step: 0.5, group: "solo.config.g.gates" },
    { key: "gateBroadcastRes", min: 0, max: 100, step: 1, group: "solo.config.g.gates" },
    { key: "deathPenalty", min: 0, max: 100, step: 1, group: "solo.config.g.reward" },
    { key: "softsignRewardScale", min: 0, max: 5, step: 0.005, group: "solo.config.g.reward" },
    { key: "resRewardScale", min: 0, max: 0.05, step: 0.0005, group: "solo.config.g.reward" },
    { key: "attackReward", min: 0, max: 5, step: 0.1, group: "solo.config.g.reward" },
    { key: "bdEntryPenalty", min: 0, max: 5, step: 0.1, group: "solo.config.g.reward" },
];

/** 出生科技：单旋钮同时写 techSpawnLo/Hi（v2.4 钉 1.0——改动即偏离同起跑线） */
export const TECH_SPAWN_KEY = "techSpawn" as const;

export function clampValue(f: CfgField, v: number): number {
    const c = Math.min(f.max, Math.max(f.min, v));
    return f.step >= 1 ? Math.round(c) : c;
}

/** 差集序列化（只存改动字段；出生科技双写 techSpawnLo/Hi） */
export function serializeConfigDiff(cfg: EnvConfig): string {
    const diff: Record<string, number> = {};
    for (const f of CFG_FIELDS) {
        const v = cfg[f.key as keyof EnvConfig] as number;
        const d = V24_CONFIG[f.key as keyof EnvConfig] as number;
        if (v !== d) diff[f.key as string] = v;
    }
    if (cfg.techSpawnLo !== V24_CONFIG.techSpawnLo || cfg.techSpawnHi !== V24_CONFIG.techSpawnHi) {
        diff[TECH_SPAWN_KEY] = cfg.techSpawnLo; // 单值语义：读取端 lo=hi 同写
    }
    return JSON.stringify(diff);
}

/**
 * 读取开局配置（sessionStorage "df.env-cfg"）。SSR/缺失/损坏/未知键 → 全默认；
 * 越界钳制；techSpawn 单键同时写 lo=hi（无继承下二者恒等）。
 */
export function readEnvConfig(): EnvConfig {
    const cfg = { ...V24_CONFIG };
    let diff: Record<string, unknown> = {};
    try {
        const raw =
            typeof window === "undefined" ? null : window.sessionStorage.getItem("df.env-cfg");
        if (raw !== null) diff = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return cfg; // 损坏 → 默认
    }
    for (const f of CFG_FIELDS) {
        const v = diff[f.key as string];
        if (typeof v === "number" && Number.isFinite(v))
            (cfg[f.key as keyof EnvConfig] as number) = clampValue(f, v);
    }
    const ts = diff[TECH_SPAWN_KEY];
    if (typeof ts === "number" && Number.isFinite(ts)) {
        const c = Math.min(20, Math.max(0, ts)); // 出生科技范围 [0,20]（默认 1.0）
        cfg.techSpawnLo = c;
        cfg.techSpawnHi = c;
    }
    return cfg;
}

/** 当前配置相对默认的偏离计数（配置面板徽标） */
export function countDeviations(cfg: EnvConfig): number {
    let n = 0;
    for (const f of CFG_FIELDS)
        if ((cfg[f.key as keyof EnvConfig] as number) !== (V24_CONFIG[f.key as keyof EnvConfig] as number))
            n++;
    if (cfg.techSpawnLo !== V24_CONFIG.techSpawnLo) n++;
    return n;
}

/** 奖励节五参数键（臂预设/默认复位须显式写全——a_classic 的 override 为空对象） */
export const REWARD_KEYS = [
    "deathPenalty",
    "softsignRewardScale",
    "resRewardScale",
    "attackReward",
    "bdEntryPenalty",
] as const;

/** 应用某臂的奖励参数：先回默认五元组再覆盖该臂 override（= 该臂训练时的奖励配置；
 * "默认"按钮 = applyArmReward(cfg, "a_classic")——评审修复 2026-10-12：曾漏 deathPenalty） */
export function applyArmReward(cfg: EnvConfig, arm: keyof typeof V24_ARMS): EnvConfig {
    const next = { ...cfg };
    for (const k of REWARD_KEYS) next[k] = V24_CONFIG[k];
    return { ...next, ...V24_ARMS[arm] };
}
