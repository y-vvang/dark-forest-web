/**
 * DQN 推理（model.py 的 TS 移植，v2.4）：float64 MLP [36→64→64→8]，ReLU 隐层/线性输出。
 * 维度自权重推导（W0 行 = obs 维、b2 长 = 动作数）——不再硬编码。
 * 权重来自 `public/models/<arm>.json`（npz 预转换；转换完整性由 dqn-parity 锁定）。
 * act 语义 = model.py:146-156：float64 前向 → 非法动作排除 → argmax（平手取先）
 * → ε 探索：先 uniformArray(B) 一次判定，再逐行 choice(合法)（同序消耗）。
 * 评测口径 ε=0.05（stage_b_v24）。
 */
import type { Rng } from "@/lib/engine/rng";

export interface ModelWeights {
    arm: string;
    source: string;
    updates: number;
    W0: number[][];
    b0: number[];
    W1: number[][];
    b1: number[];
    W2: number[][];
    b2: number[];
}

/** 按需拉取模型权重（长缓存静态资产；非 ok 抛错） */
export async function loadModel(id: string): Promise<ModelWeights> {
    const res = await fetch(`/models/${id}.json`);
    if (!res.ok) throw new Error(`model ${id}: HTTP ${res.status}`);
    return (await res.json()) as ModelWeights;
}

/** 前向：36 → 64(ReLU) → 64(ReLU) → 8（线性），float64 全程 */
export function forward(w: ModelWeights, x: Float64Array): Float64Array {
    const nIn = w.W0.length;
    const nH = w.b0.length;
    const nOut = w.b2.length;
    const h1 = new Float64Array(nH);
    const h2 = new Float64Array(nH);
    const out = new Float64Array(nOut);
    for (let r = 0; r < nIn; r++) {
        const v = x[r];
        if (v === 0) continue;
        const row = w.W0[r];
        for (let c = 0; c < nH; c++) h1[c] += v * row[c];
    }
    for (let c = 0; c < nH; c++) h1[c] = Math.max(h1[c] + w.b0[c], 0);
    for (let r = 0; r < nH; r++) {
        const v = h1[r];
        if (v === 0) continue;
        const row = w.W1[r];
        for (let c = 0; c < nH; c++) h2[c] += v * row[c];
    }
    for (let c = 0; c < nH; c++) h2[c] = Math.max(h2[c] + w.b1[c], 0);
    for (let r = 0; r < nH; r++) {
        const v = h2[r];
        if (v === 0) continue;
        const row = w.W2[r];
        for (let c = 0; c < nOut; c++) out[c] += v * row[c];
    }
    for (let c = 0; c < nOut; c++) out[c] += w.b2[c];
    return out;
}

/** 合法动作内的 argmax（平手取先） */
export function greedyPick(q: Float64Array, valid: Uint8Array | number[]): number {
    let best = -1;
    let bestV = -Infinity;
    for (let a = 0; a < q.length; a++) {
        if (valid[a] && q[a] > bestV) {
            bestV = q[a];
            best = a;
        }
    }
    return best;
}

/**
 * 单行 greedy 决策（ε=0，**零 RNG 消耗**——模型参谋专用：对玩家 obs/valid 行给出
 * 纯策略选择；不触碰会话随机流）。无合法动作时返回 0（SILENT——驱动器安全缺省）。
 */
export function act(w: ModelWeights, obsRow: Float32Array | Float64Array, validRow: Uint8Array): number {
    const q = forward(w, Float64Array.from(obsRow));
    const best = greedyPick(q, validRow);
    return best < 0 ? 0 : best;
}

/**
 * ε-greedy 批量决策（合法掩码内）：obs 行升序批量。
 * 消耗序与 model.py 一致：uniformArray(B) 一次 + 每个探索行一次 choice。
 */
export function actBatch(
    w: ModelWeights,
    obsRows: Float32Array[] | Float64Array[],
    validRows: Uint8Array[],
    eps: number,
    rng: Rng,
): number[] {
    const B = obsRows.length;
    const explore = rng.uniformArray(B); // 一次批量判定（model.py:151）
    const acts: number[] = [];
    for (let i = 0; i < B; i++) {
        const q = forward(w, Float64Array.from(obsRows[i]));
        const valid = validRows[i];
        let best = greedyPick(q, valid);
        if (explore[i] < eps) {
            const opts: number[] = [];
            for (let a = 0; a < q.length; a++) if (valid[a]) opts.push(a);
            best = opts.length > 0 ? rng.choice(opts) : best; // 合法集内探索
        }
        acts.push(best);
    }
    return acts;
}
