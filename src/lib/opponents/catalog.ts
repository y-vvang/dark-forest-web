/**
 * 对手资产目录（数据自 docs/ai-opponents.md：12 个 v23_fix 系 checkpoint + 3 个预制策略）。
 *
 * 展示约定（原型 /solo 既定，用户已验收）：模型标题 = arm id（技术记号属数据展示，
 * 非 i18n 文案）；meta/override 为 mono 读数；survival 为相对口径（sweep 臂 2 世界×40ep、
 * 单训练种子 42——引用须带披露）。⚠️ 档案内 v2.0–v2.2s checkpoint 为旧架构，不收录。
 */
export const PRESET_IDS = ["random", "df", "pacifist"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface ModelEntry {
    id: string;
    /** 长缓存权重文件（next.config: immutable） */
    file: string;
    /** mono 读数（非本地化文案） */
    meta: string;
    /** null = 无覆盖臂 */
    override: string | null;
    /** 相对口径池存活（docs/ai-opponents.md；main 为 600ep 训练主口径） */
    survival: number;
    main?: boolean;
}

export const MODEL_CATALOG: ModelEntry[] = [
    { id: "main", file: "/models/main.json", meta: "600ep · seed 42", override: null, survival: 0.627, main: true },
    { id: "base_control", file: "/models/base_control.json", meta: "150ep · seed 42", override: null, survival: 0.669 },
    { id: "shield025", file: "/models/shield025.json", meta: "150ep · seed 42", override: "shield_cost_frac=0.25", survival: 0.775 },
    { id: "shield075", file: "/models/shield075.json", meta: "150ep · seed 42", override: "shield_cost_frac=0.75", survival: 0.613 },
    { id: "scale005", file: "/models/scale005.json", meta: "150ep · seed 42", override: "reward_scale=0.005", survival: 0.747 },
    { id: "scale02", file: "/models/scale02.json", meta: "150ep · seed 42", override: "reward_scale=0.02", survival: 0.612 },
    { id: "budget100", file: "/models/budget100.json", meta: "150ep · seed 42", override: "budget=100", survival: 0.683 },
    { id: "budget200", file: "/models/budget200.json", meta: "150ep · seed 42", override: "budget=200", survival: 0.707 },
    { id: "lr3e4", file: "/models/lr3e4.json", meta: "150ep · seed 42", override: "lr=3e-4", survival: 0.618 },
    { id: "lr12e3", file: "/models/lr12e3.json", meta: "150ep · seed 42", override: "lr=1.2e-3", survival: 0.522 },
    { id: "gamma099", file: "/models/gamma099.json", meta: "150ep · seed 42", override: "gamma=0.99", survival: 0.753 },
    { id: "gamma0999", file: "/models/gamma0999.json", meta: "150ep · seed 42", override: "gamma=0.999", survival: 0.58 },
];

/** 可选对手 id（3 预设 + 12 模型）；learner 不是 id——那是 stage_b 的席位角色 */
export function isOpponentId(x: string): x is PresetId | string {
    return PRESET_IDS.includes(x as PresetId) || MODEL_CATALOG.some((m) => m.id === x);
}
