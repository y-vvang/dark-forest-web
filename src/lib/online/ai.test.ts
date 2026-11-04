import { expect, test } from "bun:test";

import { forward } from "@/lib/opponents/dqn";
import { getWeights } from "./ai";

test("getWeights: four v2.5 arms + champion, forward runs 38→8", () => {
    const w = getWeights();
    expect(w.size).toBe(5);
    for (const arm of ["a_classic", "b_terminal", "c_res", "d_malintent"]) {
        const m = w.get(arm)!;
        expect(m.arm).toBe(arm);
        expect(m.updates).toBe(149987);
        const q = forward(m, new Float64Array(38).fill(0));
        expect(q.length).toBe(8);
    }
    const champ = w.get("champion")!;
    expect(champ.updates).toBe(249789); // v3.0 champion league 1000ep
    expect(forward(champ, new Float64Array(38).fill(0)).length).toBe(8);
});
