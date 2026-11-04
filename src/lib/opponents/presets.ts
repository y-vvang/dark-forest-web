/**
 * 预制策略（stage_b_v25b.py:35-71 **v2b** 代码级口径；v2.5 信息完备世界的更新版
 * 启发式——用户 2026-11-01 裁定"手写启发式策略跟随实验更新"。train2_v25 训练口径
 * 仍为 v2.4 规则，v2b 是实验的最终启发式实现；游戏与金标准录制器同用此版锁奇偶）。
 *
 * 一选 heuristicAction（kind, valid, rng, state——state = 被决策者的 v2.5 自身态）：
 * - random   合法动作内均匀（rng.choice；合法集含 BOTHER）——无信息对照，不变
 * - df       STRIKE 一合法即打（零 rng）→ 否则 OBSERVE 合法且 u<0.3 → 否则
 *             **under_attack && valid[INVADE] && last_invader>=0 → INVADE（反咬一选，
 *             零 rng、跳过 0.6 抽签）** → 否则 u<0.6 ? DEVELOP : SILENT
 * - pacifist **hiding = under_attack || public：valid[BD] && !in_domain → BD；域内或
 *             藏匿期恒 SILENT（零 rng、跳过 0.5 抽签）**；未受威胁 u<0.5 ? DEVELOP : SILENT
 *
 * 目标二选 pickTarget（v2b）：df + INVADE + under_attack 且 last_invader∈候选 →
 * 反咬 last_invader；否则 df 入侵最弱 / 其余目标动作最强（"入侵保命、打击/揭露
 * 领跑者"）；random/模型 → 均匀 rng.choice。
 * ⚠️ pick_target_v2 的 "random/learner" 分支（cand[0]/argmax）在调用方为死代码，
 * 不移植（docs/ai-opponents.md 披露沿袭）。
 */
import type { Rng } from "@/lib/engine/rng";
import {
    A_BDOMAIN,
    A_DEVELOP,
    A_INVADE,
    A_OBSERVE,
    A_SILENT,
    A_STRIKE,
    N_ACTIONS,
} from "@/lib/engine/types";

export type PresetKind = "random" | "df" | "pacifist";

/** v2.5 自身态（v2b 启发式的决策输入） */
export interface PresetState {
    underAttack: boolean;
    public: boolean;
    inDomain: boolean;
    lastInvader: number;
}

/** presets 与 env 解耦的结构类型（DarkForestEnv2 满足之） */
interface PresetEnvLike {
    under_attack: Uint8Array;
    public_: Uint8Array;
    in_domain: Uint8Array;
    last_invader: Int32Array;
}

/** 从 env 提取 i 号的自身态（调用点统一走此助手，防漏读/错读） */
export function presetStateOf(env: PresetEnvLike, i: number): PresetState {
    return {
        underAttack: env.under_attack[i] === 1,
        public: env.public_[i] === 1,
        inDomain: env.in_domain[i] === 1,
        lastInvader: env.last_invader[i],
    };
}

export function heuristicAction(
    kind: PresetKind,
    valid: Uint8Array,
    rng: Rng,
    state: PresetState,
): number {
    if (kind === "random") {
        const opts: number[] = [];
        for (let a = 0; a < N_ACTIONS; a++) if (valid[a]) opts.push(a);
        return opts.length > 0 ? rng.choice(opts) : A_SILENT;
    }
    if (kind === "df") {
        if (valid[A_STRIKE]) return A_STRIKE;
        if (valid[A_OBSERVE] && rng.uniform() < 0.3) return A_OBSERVE;
        // v2b 反咬一选（stage_b_v25b.py:61-62）：被咬的下一刻咬回去——零 rng、跳过 0.6 抽签
        if (state.underAttack && valid[A_INVADE] && state.lastInvader >= 0) return A_INVADE;
        return rng.uniform() < 0.6 ? A_DEVELOP : A_SILENT;
    }
    // pacifist v2b 藏匿（stage_b_v25b.py:64-70）：受威胁（被入侵/被公开）→ 黑域封存；
    // 域内或藏匿期恒静默（零 rng、跳过 0.5 抽签）
    const hiding = state.underAttack || state.public;
    if (hiding && valid[A_BDOMAIN] && !state.inDomain) return A_BDOMAIN;
    if (state.inDomain || hiding) return A_SILENT;
    return rng.uniform() < 0.5 ? A_DEVELOP : A_SILENT;
}

export function pickTarget(
    kind: "df" | "random" | "model",
    cand: number[],
    tech: Float64Array,
    action: number,
    rng: Rng,
    state: PresetState,
): number {
    if (kind === "df") {
        // v2b 反咬目标（stage_b_v25b.py:41-43）：df + INVADE + under_attack 且
        // last_invader 在候选内 → 咬它（零 rng；不在候选则回落常规分支）
        if (action === A_INVADE && state.underAttack && state.lastInvader >= 0) {
            if (cand.includes(state.lastInvader)) return state.lastInvader;
        }
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
