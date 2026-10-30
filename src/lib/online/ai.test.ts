import { expect, test } from "bun:test";

import { forward } from "@/lib/opponents/dqn";
import { getWeights } from "./ai";

test("getWeights: four v2.4 arms, forward runs 36→8", () => {
    const w = getWeights();
    expect(w.size).toBe(4);
    for (const arm of ["a_classic", "b_terminal", "c_res", "d_malintent"]) {
        const m = w.get(arm)!;
        expect(m.arm).toBe(arm);
        expect(m.updates).toBe(149987);
        const q = forward(m, new Float64Array(36).fill(0));
        expect(q.length).toBe(8);
    }
});
