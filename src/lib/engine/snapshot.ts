/**
 * 状态快照与守恒断言 —— 金标准逐刻比对的载体。
 *
 * snapshot() 导出 env 全部状态字段为纯 JSON 形状（键名与 env2.py /
 * scripts/golden/record_golden.py 的 snapshot() 一致）；compareState 返回首个差异
 * 描述（null=全同）；assertConservation 每刻校验守恒不变量（CLAUDE.md 验收门 2）。
 */
import type { DarkForestEnv2 } from "./env";

export interface EnvSnapshot {
    t: number;
    pos: number[];
    tech: number[];
    res: number[];
    alive: number[];
    known: number[];
    observed: number[];
    public: number[];
    in_domain: number[];
    domain_windup: number[];
    pending_reveal: ["self", number][];
    pending_counter: number[];
    last_action: number[];
    first_detect_tick: number[];
    free_pool: number;
    pending_spawns: number[];
    birth_log: [number, number, number][];
    death_cause: string[];
    spawn_tick: number[];
    spawn_tech: number[];
    spawn_res: number[];
    peak_tech: number[];
    /** 派生量（录制端同款）：Σres + free_pool —— 与 res_total 的差即守恒残差 */
    spawn_total_res: number;
}

export function snapshot(env: DarkForestEnv2): EnvSnapshot {
    let sum = 0;
    for (let i = 0; i < env.n; i++) sum += env.res[i];
    return {
        t: env.t,
        pos: [...env.pos],
        tech: [...env.tech],
        res: [...env.res],
        alive: [...env.alive],
        known: [...env.known],
        observed: [...env.observed],
        public: [...env.public_],
        in_domain: [...env.in_domain],
        domain_windup: [...env.domain_windup],
        pending_reveal: env.pending_reveal.map((x) => [...x] as ["self", number]),
        pending_counter: [...env.pending_counter],
        last_action: [...env.last_action],
        first_detect_tick: [...env.first_detect_tick],
        free_pool: env.free_pool,
        pending_spawns: [...env.pending_spawns],
        birth_log: env.birth_log.map((x) => [...x] as [number, number, number]),
        death_cause: [...env.death_cause],
        spawn_tick: [...env.spawn_tick],
        spawn_tech: [...env.spawn_tech],
        spawn_res: [...env.spawn_res],
        peak_tech: [...env.peak_tech],
        spawn_total_res: sum + env.free_pool,
    };
}

/**
 * 逐字段比较两个快照。数字用 |Δ|≤tol（np.sum 成对求和 vs 顺序累加的末位差披露，
 * game-mechanics.md §3.2）；数组元素逐一比较；字符串/元组精确相等。
 * 返回首个差异描述，全同返回 null。
 */
export function compareState(
    a: EnvSnapshot,
    b: EnvSnapshot,
    tol = 1e-12,
    path = "state",
): string | null {
    const keysA = Object.keys(a) as (keyof EnvSnapshot)[];
    for (const k of keysA) {
        if (!(k in (b as object))) return `${path}.${k}: recorded snapshot missing key`;
        const va = a[k];
        const vb = (b as EnvSnapshot)[k];
        if (Array.isArray(va) && Array.isArray(vb)) {
            if (va.length !== vb.length) return `${path}.${k}: length ${va.length} != ${vb.length}`;
            for (let i = 0; i < va.length; i++) {
                const xa = va[i];
                const xb = vb[i];
                if (Array.isArray(xa) && Array.isArray(xb)) {
                    if (xa.length !== xb.length) return `${path}.${k}[${i}]: tuple length`;
                    for (let j = 0; j < xa.length; j++)
                        if (xa[j] !== xb[j]) return `${path}.${k}[${i}][${j}]: ${xa[j]} != ${xb[j]}`;
                } else if (typeof xa === "number" && typeof xb === "number") {
                    if (Math.abs(xa - xb) > tol) return `${path}.${k}[${i}]: ${xa} != ${xb}`;
                } else if (xa !== xb) {
                    return `${path}.${k}[${i}]: ${String(xa)} != ${String(xb)}`;
                }
            }
        } else if (typeof va === "number" && typeof vb === "number") {
            if (Math.abs(va - vb) > tol) return `${path}.${k}: ${va} != ${vb}`;
        } else if (va !== vb) {
            return `${path}.${k}: ${String(va)} != ${String(vb)}`;
        }
    }
    return null;
}

/** 守恒不变量（env2.py:623 口径）：|总量 − Σ全部槽 res − 自由池| ≤ 1e-6 */
export function assertConservation(env: DarkForestEnv2): void {
    let sum = 0;
    for (let i = 0; i < env.n; i++) sum += env.res[i];
    const residual = env.res_total - sum - env.free_pool;
    if (Math.abs(residual) > 1e-6)
        throw new Error(`conservation violated at t=${env.t}: residual ${residual}`);
}
