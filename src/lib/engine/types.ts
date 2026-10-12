/**
 * 引擎类型与常量 —— 与 env2_v24.py 一一对应（v2.4）。
 *
 * 命名约定：字段/键保持 env2_v24.py 的 snake_case（parity 优先；人类工程学由会话视图层承担）。
 * 动作枚举序（env2_v24.py:85-90）：SILENT/DEVELOP/BROADCAST_ALL/BROADCAST_OTHER/
 * STRIKE/BLACK_DOMAIN/INVADE/OBSERVE——v2.4 删 STRIKE_WEAK/STRONG（观测前作弊）、
 * BOTHER 恢复为揭露目标、BSELF 改名 BALL（语义不变）。
 */

// ------------------------------------------------------------------ actions
export const A_SILENT = 0 as const;
export const A_DEVELOP = 1 as const;
export const A_BALL = 2 as const; // v2.4 改名自 BROADCAST_SELF（语义同：全体广播自己坐标）
export const A_BOTHER = 3 as const; // v2.4 恢复：揭露 known 目标坐标给全宇宙（发送者不暴露）
export const A_STRIKE = 4 as const;
export const A_BDOMAIN = 5 as const;
export const A_INVADE = 6 as const;
export const A_OBSERVE = 7 as const; // v2.4 起显式选目标（最近已知兜底，同 STRIKE 协议）

export type ActionId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const N_ACTIONS = 8;
export const NEAR_K = 3;
export const OBS_DIM = 7 + N_ACTIONS + NEAR_K * 7; // = 36（env2_v24.py:91）

// --------------------------------------------------------------------- info
/** "" 存活/未生；strike|invade|mutual|starve 为死亡原因（env2_v24.py:227） */
export type DeathCause = "" | "strike" | "invade" | "mutual" | "starve";

/** [i, j, outcome, tech_i, tech_j, take] —— take 仅 blocked 时非零（env2_v24.py:500） */
export type StrikeEvent = [
    number,
    number,
    "killed" | "survived" | "blocked",
    number,
    number,
    number,
];

/**
 * resolve() 的 info 事件流（env2_v24.py:642-653）——游戏渲染的直接数据源，
 * 键/形状与金标准轨迹逐位同形（died_this_tick = [slot, cause]）。
 */
export interface TickInfo {
    detections: [number, number][];
    strikes: [number, number, boolean][];
    invasions: [number, number, boolean][];
    loot_to: Float64Array;
    died_this_tick: [number, DeathCause][];
    strikes_blocked: [number, number, number][];
    strike_events: StrikeEvent[];
    free_pool: number;
    res_conservation_residual: number;
    n_births: number;
    n_alive: number;
    in_domain: number;
    counter_detections: number;
}

/**
 * TS-only 奖励诊断（游戏层扩展，非 parity 部分——录制端 info 无此字段）：
 * 逐刻 per-civ 奖励原料，在 rewards 计算处顺带记录。视图层据此组合任意参数集
 * （当前配置 / 四奖励臂）的奖励流，而不重算事件归属。
 * - techTerm：DEVELOP 刻的 softsign 形状值 tech/(1+a|tech|)（reward 时刻、含本刻增长）
 * - resAtReward：同刻 res（含流失；res>0 才有津贴语义）
 * - attackCount：打击击杀认领 + 入侵缴获（含反咬）+ BOTHER 揭露 成功次数
 * - bdEnter：本刻声明入域（entering）标志
 */
export interface RewardDetail {
    techTerm: Float64Array;
    resAtReward: Float64Array;
    attackCount: Int32Array;
    bdEnter: Uint8Array;
}

/** resolve() 返回（env2_v24.py:654）：obs(n×36 f32) / valid(n×8) 平铺行主序 */
export interface TickResult {
    obs: Float32Array;
    valid: Uint8Array;
    rewards: Float64Array;
    alive: Uint8Array;
    done: boolean;
    info: TickInfo;
    deadNow: Uint8Array;
    rewardDetail: RewardDetail;
}
