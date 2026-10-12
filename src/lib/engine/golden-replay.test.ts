/**
 * 金标准录制-回放（CLAUDE.md 验收门 3 + 4）：Python 端录制的 RNG 消耗流喂入
 * ReplayRng → TS 引擎逐刻重演 → 全状态 + obs + info + rewards 精确比对。
 * 消耗序由 ReplayRng 的方法+参数断言直接锁定（Review Focus 1）。
 *
 * 容差口径（testdata/README.md）：状态/奖励 1e-12（np.sum 末位差兜底）；
 * obs（float32）1e-6；info 浮点 1e-10。逻辑偏差会造成巨大差异，立即爆出。
 */
import { expect, test } from "bun:test";

import type { EnvConfig } from "./config";
import { DarkForestEnv2 } from "./env";
import { ReplayRng } from "./rng";
import { assertConservation, compareState, snapshot } from "./snapshot";
import { applyPatch, decodeObs, expectDeepClose, loadTrace } from "./testdata-io";

const TRACES = [
    "trace-main-s1",
    "trace-main-s2",
    "trace-main-d",
    "trace-tgt-mutual",
    "trace-tgt-shield",
    "trace-tgt-windup",
    "trace-tgt-heat",
];

for (const name of TRACES) {
    test(`golden replay: ${name}`, () => {
        const tr = loadTrace(name);
        const rng = new ReplayRng(tr.rngLog);
        // v2.4：轨迹自带完整 env 参数（奖励臂轨迹用其训练 config 录制）
        const env = new DarkForestEnv2(tr.meta.cfg as EnvConfig, rng);
        env.reset();
        if (tr.reset.patch) applyPatch(env, tr.reset.patch);

        // reset 段：全状态 + 补丁后 obs
        const resetDiff = compareState(snapshot(env), tr.reset.state, 1e-12);
        expect(resetDiff ?? "").toBe("");
        const resetFails: string[] = [];
        expectDeepClose(env.obs(), decodeObs(tr.reset.obs), 1e-6, "reset.obs", resetFails);
        expect(resetFails.join("; ")).toBe("");

        let done = false;
        for (let k = 0; k < tr.ticks.length && !done; k++) {
            const tk = tr.ticks[k];
            const invaded = env.beginTick(
                Int32Array.from(tk.actions),
                Int32Array.from(tk.targets),
            );
            const fails: string[] = [];
            expectDeepClose(invaded, tk.invaded, 0, `t${k}.invaded`, fails);
            if (tk.reObs !== null)
                expectDeepClose(env.obs(), decodeObs(tk.reObs), 1e-6, `t${k}.reObs`, fails);

            const r = env.resolve(Int32Array.from(tk.reActions));

            const stateDiff = compareState(snapshot(env), tk.post.state, 1e-12);
            if (stateDiff) fails.push(`t${k}.state: ${stateDiff}`);
            expectDeepClose(env.obs(), decodeObs(tk.post.obs), 1e-6, `t${k}.obs`, fails);
            expectDeepClose(r.done, tk.post.done, 0, `t${k}.done`, fails);
            expectDeepClose(r.rewards, tk.post.rewards, 1e-12, `t${k}.rewards`, fails);
            expectDeepClose(r.info, tk.post.info, 1e-10, `t${k}.info`, fails);
            expect(fails.join("; "), `tick ${k} divergence`).toBe("");
            assertConservation(env);
            done = r.done;
        }
        rng.assertExhausted();
    });
}
