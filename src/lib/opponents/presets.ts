/**
 * 预制策略（train2_v24.py:40-52 + stage_b_v24.py:45-52 代码级口径；v2.4 动作集 8）。
 *
 * 一选 heuristicAction：
 * - random   合法动作内均匀（rng.choice；v2.4 合法集含 BOTHER）
 * - df       STRIKE 一合法即打（零 rng 消耗）→ 否则 OBSERVE 合法且 u<0.3 → 否则
 *             u<0.6 ? DEVELOP : SILENT
 * - pacifist u<0.5 ? DEVELOP : SILENT（永不攻击）
 *
 * 目标二选 pickTarget（stage_b 口径）：df → INVADE 取候选最弱 / 其余目标动作取候选
 * 最强（"入侵保命、打击/揭露领跑者"）；random 与模型对手 → 均匀 rng.choice。
 * ⚠️ train2_v24.pick_target 的 "random/learner" 分支（cand[0]/argmax）在两个调用方均为
 * 死代码，不移植（docs/ai-opponents.md 已披露）。
 */
import type { Rng } from "@/lib/engine/rng";
import {
    A_DEVELOP,
    A_INVADE,
    A_OBSERVE,
    A_SILENT,
    A_STRIKE,
    N_ACTIONS,
} from "@/lib/engine/types";

export type PresetKind = "random" | "df" | "pacifist";

export function heuristicAction(kind: PresetKind, valid: Uint8Array, rng: Rng): number {
    if (kind === "random") {
        const opts: number[] = [];
        for (let a = 0; a < N_ACTIONS; a++) if (valid[a]) opts.push(a);
        return opts.length > 0 ? rng.choice(opts) : A_SILENT;
    }
    if (kind === "df") {
        if (valid[A_STRIKE]) return A_STRIKE;
        if (valid[A_OBSERVE] && rng.uniform() < 0.3) return A_OBSERVE;
        return rng.uniform() < 0.6 ? A_DEVELOP : A_SILENT;
    }
    return rng.uniform() < 0.5 ? A_DEVELOP : A_SILENT; // pacifist
}

export function pickTarget(
    kind: "df" | "random" | "model",
    cand: number[],
    tech: Float64Array,
    action: number,
    rng: Rng,
): number {
    if (kind === "df") {
        // 平手取先（np.argmin/argmax 语义）
        if (action === A_INVADE) {
            let best = cand[0];
            for (const j of cand) if (tech[j] < tech[best]) best = j;
            return best; // 入侵最弱（安全击杀）
        }
        let best = cand[0];
        for (const j of cand) if (tech[j] > tech[best]) best = j;
        return best; // 打击最强（诅咒领跑者）
    }
    return rng.choice(cand); // random / 模型对手：均匀（stage_b.py:52）
}
