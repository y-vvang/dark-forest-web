/**
 * 统计等价第二口径（CLAUDE.md 验收门 3 的"多世界统计等价"腿）。
 * 录制-回放已确定性覆盖逻辑等价——本测试仅防"录制器与被测两端同错"的系统性风险：
 * TS 引擎自跑 N 局（GameRng，与 stats.json 的 Python 参考聚合不同随机流、同规则结构），
 * 均值落在披露带宽内；**守恒不变量每刻硬断言**（这才是硬门槛）。
 * 带宽披露（testdata/README.md）：aliveFrac ±0.10、kills ±12、actionFreqs ±0.06——
 * 10 局样本的带宽，只为拦结构性偏差（如 df 永不打击），非精确对齐。
 */
import { expect, test } from "bun:test";

import { V24_CONFIG } from "./config";
import { DarkForestEnv2 } from "./env";
import { GameRng, seedOf } from "./rng";
import { assertConservation } from "./snapshot";
import { loadStats } from "./testdata-io";
import { heuristicAction, pickTarget, type PresetKind } from "@/lib/opponents/presets";
import { A_BOTHER, A_INVADE, A_OBSERVE, A_STRIKE } from "@/lib/engine/types";

const N = 10;
const TARGET_ACTIONS: number[] = [A_INVADE, A_STRIKE, A_BOTHER, A_OBSERVE]; // v2.4 目标请求集

test("stat equivalence: TS env vs python reference aggregates (presets-only pool)", () => {
    const stats = loadStats();
    const n = V24_CONFIG.nAgents;
    const tMax = V24_CONFIG.tMax;
    let aliveTicksTotal = 0;
    let killsTotal = 0;
    const actCounts = new Float64Array(8); // v2.4：N_ACTIONS 8

    for (let ep = 0; ep < N; ep++) {
        const seed = 51001 + ep;
        const env = new DarkForestEnv2(V24_CONFIG, new GameRng([seedOf(seed, "env")]));
        env.reset();
        const session = new GameRng([seedOf(seed, "session")]); // 预制决策共享流（stage_b 口径）
        const kinds: PresetKind[] = [];
        for (let i = 0; i < n; i++) kinds.push((["random", "df", "pacifist"] as const)[i % 3]);

        let done = false;
        while (!done) {
            const valid = env.valid();
            const actions = new Int32Array(n);
            for (let i = 0; i < n; i++) {
                if (env.alive[i]) {
                    actions[i] = heuristicAction(
                        kinds[i],
                        valid.subarray(i * 8, (i + 1) * 8),
                        session,
                    );
                }
            }
            const tmask = env.selectTargets(actions);
            const targets = new Int32Array(n).fill(-1);
            for (let i = 0; i < n; i++) {
                if (!TARGET_ACTIONS.includes(actions[i])) continue;
                const cand: number[] = [];
                for (let j = 0; j < n; j++) if (tmask[i * n + j]) cand.push(j);
                if (cand.length > 0)
                    targets[i] = pickTarget(kinds[i] === "df" ? "df" : "random", cand, env.tech, actions[i], session);
            }
            const invaded = env.beginTick(actions, targets);
            const re = Int32Array.from(actions);
            for (const v of invaded) {
                re[v] = heuristicAction(kinds[v], valid.subarray(v * 8, (v + 1) * 8), session);
            }
            const r = env.resolve(re);
            for (let i = 0; i < n; i++) if (env.alive[i]) aliveTicksTotal++;
            for (let i = 0; i < n; i++) if (env.alive[i]) actCounts[re[i]]++;
            for (const s of r.info.strikes) if (s[2]) killsTotal++;
            assertConservation(env);
            done = r.done;
        }
    }

    const aliveFrac = aliveTicksTotal / (N * n * tMax);
    const meanKills = killsTotal / N;
    const actTotal = actCounts.reduce((s, v) => s + v, 0);
    // 带宽（README 披露）：拦结构性偏差
    expect(Math.abs(aliveFrac - stats.meanAliveFrac)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(meanKills - stats.meanKills)).toBeLessThanOrEqual(12);
    for (let a = 0; a < 8; a++) {
        const freq = actCounts[a] / actTotal;
        expect(Math.abs(freq - stats.actionFreqs[a])).toBeLessThanOrEqual(0.06);
    }
});
