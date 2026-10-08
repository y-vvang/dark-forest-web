/**
 * 引擎类型与常量 —— 与 env2.py 一一对应（v2.3-fix）。
 *
 * 命名约定：字段/键保持 env2.py 的 snake_case（parity 优先；人类工程学由会话视图层承担）。
 * 动作枚举序（env2.py:59-67）：SILENT/DEVELOP/BROADCAST_SELF/BROADCAST_OTHER(retired)/
 * STRIKE/BLACK_DOMAIN/INVADE/OBSERVE/STRIKE_WEAK/STRIKE_STRONG。
 */

// ------------------------------------------------------------------ actions
export const A_SILENT = 0 as const;
export const A_DEVELOP = 1 as const;
export const A_BSELF = 2 as const;
export const A_BOTHER = 3 as const;
export const A_STRIKE = 4 as const;
export const A_BDOMAIN = 5 as const;
export const A_INVADE = 6 as const;
export const A_OBSERVE = 7 as const;
export const A_STRIKE_WEAK = 8 as const;
export const A_STRIKE_STRONG = 9 as const;

export type ActionId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const N_ACTIONS = 10;
export const NEAR_K = 3;
export const OBS_DIM = 7 + N_ACTIONS + NEAR_K * 7; // = 38（env2.py:70 注释"36"已过时）

// --------------------------------------------------------------------- info
/** "" 存活/未生；strike|invade|mutual|starve 为死亡原因（env2.py:202） */
export type DeathCause = "" | "strike" | "invade" | "mutual" | "starve";

/** [i, j, outcome, tech_i, tech_j, take] —— take 仅 blocked 时非零（env2.py:489-494） */
export type StrikeEvent = [
    number,
    number,
    "killed" | "survived" | "blocked",
    number,
    number,
    number,
];

/**
 * resolve() 的 info 事件流（env2.py:616-627）——游戏渲染的直接数据源，
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

/** resolve() 返回（env2.py:628）：obs(n×38 f32) / valid(n×10) 平铺行主序 */
export interface TickResult {
    obs: Float32Array;
    valid: Uint8Array;
    rewards: Float64Array;
    alive: Uint8Array;
    done: boolean;
    info: TickInfo;
    deadNow: Uint8Array;
}
