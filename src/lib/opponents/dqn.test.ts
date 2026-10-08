import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ScriptedRng } from "@/lib/engine/rng";
import { actBatch, forward, type ModelWeights } from "./dqn";

const OUTS = JSON.parse(
    readFileSync("src/lib/engine/testdata/dqn-outputs.json", "utf8"),
) as { arms: { arm: string; inputs: number[][]; outputs: number[][] }[] };

test("dqn parity vs numpy forward (all 12 arms, |ΔQ|<=1e-9)", () => {
    for (const rec of OUTS.arms) {
        const w = JSON.parse(readFileSync(`public/models/${rec.arm}.json`, "utf8")) as ModelWeights;
        for (let r = 0; r < 10; r++) {
            const q = forward(w, Float64Array.from(rec.inputs[r]));
            for (let a = 0; a < 10; a++) {
                const d = Math.abs(q[a] - rec.outputs[r][a]);
                if (d > 1e-9)
                    expect(`${rec.arm}[${r}][${a}]: Δ=${d}`).toBe("<=1e-9");
            }
        }
    }
});

test("actBatch: masked argmax at ε=0 (consumes nothing but the explore roll)", () => {
    const w = JSON.parse(readFileSync("public/models/main.json", "utf8")) as ModelWeights;
    const x = Float32Array.from(OUTS.arms[0].inputs[0]);
    const allValid = new Uint8Array(10).fill(1);
    const halfValid = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    const rng = new ScriptedRng([], 0.9); // ε=0 → explore 判定 0.9<0 为假 → 零额外消耗
    const acts = actBatch(w, [x], [allValid], 0, rng);
    // 与 forward 自洽：全合法 argmax（平手取先）
    const q = forward(w, Float64Array.from(x));
    let best = 0;
    for (let a = 1; a < 10; a++) if (q[a] > q[best]) best = a;
    expect(acts).toEqual([best]);
    expect(rng.consumed).toBe(1); // uniformArray(B) 恒调用一次
    // 非法动作被屏蔽：argmax 只在合法集内
    const rng2 = new ScriptedRng([], 0.9);
    const acts2 = actBatch(w, [x], [halfValid], 0, rng2);
    let best2 = -1;
    let bv = -Infinity;
    for (let a = 0; a < 10; a++)
        if (halfValid[a] && q[a] > bv) {
            bv = q[a];
            best2 = a;
        }
    expect(acts2).toEqual([best2]);
    expect(best2 % 2).toBe(0); // 只在偶数下标（合法集）中
});

test("actBatch: ε explore consumption order — uniformArray(B) first, then per-row choice (model.py:146-156)", () => {
    const w = JSON.parse(readFileSync("public/models/main.json", "utf8")) as ModelWeights;
    const x = Float32Array.from(OUTS.arms[0].inputs[0]);
    const halfValid = new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    // ScriptedRng 原样契约：队列第一个值 = explore 判定（0.3 < ε=1 → 探索），
    // 第二个值 = choice 返回的被选动作 3（须在合法集内）
    const rng = new ScriptedRng([0.3, 3], 0.5);
    expect(actBatch(w, [x], [halfValid], 1, rng)).toEqual([3]);
    expect(rng.consumed).toBe(2);
});

test("loadModel path shape (static JSON round-trip via JSON.parse)", () => {
    const w = JSON.parse(readFileSync("public/models/main.json", "utf8")) as ModelWeights;
    expect(w.arm).toBe("main");
    expect(w.updates).toBe(149985);
    expect(w.W0.length).toBe(38);
    expect(w.W0[0].length).toBe(64);
    expect(w.W1.length).toBe(64);
    expect(w.W1[0].length).toBe(64);
    expect(w.W2.length).toBe(64);
    expect(w.W2[0].length).toBe(10);
    expect(w.b0.length).toBe(64);
    expect(w.b1.length).toBe(64);
    expect(w.b2.length).toBe(10);
});
