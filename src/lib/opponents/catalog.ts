/**
 * 对手资产目录（v2.4：3 预制策略 + 4 奖励臂模型，**合并单一列表**——用户 2026-10-10：
 * 原"预制/模型"分节有误导性；对手详情概括动作画像而非罗列胜率）。
 *
 * 展示约定：模型标题 = 臂 id（技术记号属数据展示，非 i18n 文案）；meta/override 为
 * mono 读数（自 runs/v25_arms/<arm>/config.yaml 推导——经 V25_ARMS 引用引擎配置，
 * 不重复抄数）；画像 prose 走 i18n（opp.arm.<id>.desc，源自 reports/v25_brief.md
 * 的 150ep 混战池动作分布，单训练种子 42 披露）。
 */
import { V25_ARMS, V25_CONFIG, type EnvConfig } from "@/lib/engine/config";
import type { MessageKey } from "@/i18n";

export const PRESET_IDS = ["random", "df", "pacifist"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetEntry {
    kind: "preset";
    id: PresetId;
    name: MessageKey;
    desc: MessageKey;
}

export interface ModelEntry {
    kind: "model";
    /** v2.4 奖励臂 id（=权重文件名） */
    id: string;
    /** 长缓存权重文件（next.config: immutable） */
    file: string;
    /** mono 读数（非本地化文案） */
    meta: string;
    /** mono 奖励参数行（自 V25_ARMS 推导；游戏层奖励展示共用同一参数源） */
    override: string;
    /** 动作画像（i18n prose，单种子披露见 solo.disclosure） */
    profile: MessageKey;
}

export const PRESETS: PresetEntry[] = [
    { kind: "preset", id: "random", name: "opp.random.name", desc: "opp.random.desc" },
    { kind: "preset", id: "df", name: "opp.df.name", desc: "opp.df.desc" },
    { kind: "preset", id: "pacifist", name: "opp.pacifist.name", desc: "opp.pacifist.desc" },
];

const ARM_CATALOG_IDS = ["a_classic", "b_terminal", "c_res", "d_malintent"] as const;

export const MODEL_CATALOG: ModelEntry[] = [
    ...ARM_CATALOG_IDS.map((id) => ({
        kind: "model" as const,
        id,
        file: `/models/${id}.json`,
        meta: "600ep · seed 42",
        override: rewardOverrideLine(V25_ARMS[id]),
        profile: `opp.arm.${id}.desc` as MessageKey,
    })),
    {
        // v3.0 champion（league 1000ep，seed 42——"见过所有策略家族的泛化体"；训练用
        // config_v25 缺省奖励 = 经典参数。用户 2026-11-01 裁定入目录与在线轮替）
        kind: "model" as const,
        id: "champion",
        file: "/models/champion.json",
        meta: "1000ep league · seed 42",
        override: rewardOverrideLine({}),
        profile: "opp.champion.desc" as MessageKey,
    },
];

/** 全部模型 id（client.ts 参谋遍历源——四臂 + champion；奖励面板仍用 rewards.ARM_IDS） */
export const MODEL_IDS: string[] = MODEL_CATALOG.map((m) => m.id);

/** 合并单一列表：预制在前、模型按 a→d 臂序（URL op 参数序与此一致） */
export const OPPONENTS: (PresetEntry | ModelEntry)[] = [...PRESETS, ...MODEL_CATALOG];

export function isOpponentId(x: string): x is PresetId | string {
    return PRESET_IDS.includes(x as PresetId) || MODEL_CATALOG.some((m) => m.id === x);
}

/** 模型 id 集（client.ts 区分模型/预制以决定是否 fetch 权重） */
export function isModelId(x: string): boolean {
    return MODEL_CATALOG.some((m) => m.id === x);
}

/**
 * 奖励臂参数的 mono 读数行（相对 a_classic 基线 = soft 0.01 · bd 0.5 的差示）：
 * b_terminal 显式归零，c/d 追加资源津贴/攻击赏金。death 10 全臂一致不列。
 */
export function rewardOverrideLine(params: Partial<EnvConfig>): string {
    const soft = params.softsignRewardScale ?? V25_CONFIG.softsignRewardScale;
    const bd = params.bdEntryPenalty ?? V25_CONFIG.bdEntryPenalty;
    const parts = [`soft ${soft}`, `bd ${bd}`];
    if (params.resRewardScale !== undefined && params.resRewardScale > 0)
        parts.push(`+res ${params.resRewardScale}`);
    if (params.attackReward !== undefined && params.attackReward > 0)
        parts.push(`+attack ${params.attackReward}`);
    return parts.join(" · ");
}
