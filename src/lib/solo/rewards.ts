/**
 * 奖励组合（游戏层）：把引擎的逐刻奖励原料（TickResult.rewardDetail——TS-only 诊断）
 * 组合成任意参数集的奖励流——①当前开局配置（cfg 注入）②v2.5 四奖励臂（固定参数，
 * runs/v25_arms/<arm>/config.yaml，经 V25_ARMS 引用不重复抄数）。
 *
 * 口径（用户 2026-10-10 确认）：match 页展示 = 配置流 + 四臂对比；
 * 配置界面披露"奖励参数不影响对手模型行为"（模型为冻结策略）。
 */
import { V25_ARMS, V25_CONFIG, type EnvConfig } from "@/lib/engine/config";
import type { RewardDetail } from "@/lib/engine/types";

/** v2.4 四奖励臂 id（展示序 = 目录序） */
export const ARM_IDS = ["a_classic", "b_terminal", "c_res", "d_malintent"] as const;

/** 臂的完整 env 参数（V25_CONFIG + 该臂 override） */
export function armParamsOf(id: string): EnvConfig {
    const o = V25_ARMS[id];
    if (o === undefined) throw new Error(`rewards: unknown arm ${id}`);
    return { ...V25_CONFIG, ...o };
}

/** 单刻/累计的奖励原料（自 rewardDetail 提取；death 自 deadNow） */
export interface RewardIngredients {
    /** Σ softsign 形状值 tech/(1+a|tech|)（仅 DEVELOP 活跃刻） */
    techTerm: number;
    /** Σ 同刻 res（res 津贴底数） */
    resAtReward: number;
    /** Σ 击杀认领 + 入侵缴获 + 揭露 次数 */
    attackCount: number;
    /** 声明入域次数 */
    bdEnter: number;
    /** 死亡次数（终局刻 1） */
    death: number;
}

export function emptyIngredients(): RewardIngredients {
    return { techTerm: 0, resAtReward: 0, attackCount: 0, bdEnter: 0, death: 0 };
}

/** 从某刻 rewardDetail（+deadNow）为槽位 p 提取原料，累加进 ing。
 *  长度守卫（评审 I-1）：_grow 扩容刻的 resolve 数组按旧 n 分配（python 同构），
 *  增长槽（旧 n 起的 index）越界读 undefined → NaN 永久污染——该刻无原料即返回。 */
export function addIngredients(
    ing: RewardIngredients,
    detail: RewardDetail,
    deadNow: Uint8Array,
    p: number,
): void {
    if (p >= detail.techTerm.length) return;
    ing.techTerm += detail.techTerm[p];
    ing.resAtReward += detail.resAtReward[p];
    ing.attackCount += detail.attackCount[p];
    ing.bdEnter += detail.bdEnter[p];
    ing.death += deadNow[p] === 1 ? 1 : 0;
}

/** 原料 → 某参数集下的奖励值（与 env2_v24.py:611-629 同式；res 津贴 >0 才加——照抄） */
export function rewardOf(
    ing: RewardIngredients,
    params: Pick<
        EnvConfig,
        "deathPenalty" | "softsignRewardScale" | "resRewardScale" | "attackReward" | "bdEntryPenalty"
    >,
): number {
    let r = -params.deathPenalty * ing.death;
    r += params.softsignRewardScale * ing.techTerm;
    if (params.resRewardScale > 0) r += params.resRewardScale * ing.resAtReward;
    r += params.attackReward * ing.attackCount;
    r -= params.bdEntryPenalty * ing.bdEnter;
    return r;
}

/** 当前配置下的分量明细（累计；显示口径与 rewardOf 一致） */
export function partsOf(
    ing: RewardIngredients,
    params: Pick<
        EnvConfig,
        "deathPenalty" | "softsignRewardScale" | "resRewardScale" | "attackReward" | "bdEntryPenalty"
    >,
): { stipend: number; res: number; bounty: number; bdEntry: number; death: number } {
    return {
        stipend: params.softsignRewardScale * ing.techTerm,
        res: params.resRewardScale > 0 ? params.resRewardScale * ing.resAtReward : 0,
        bounty: params.attackReward * ing.attackCount,
        bdEntry: -params.bdEntryPenalty * ing.bdEnter,
        death: -params.deathPenalty * ing.death,
    };
}
