import { expect, test } from "bun:test";

import { V24_CONFIG } from "@/lib/engine/config";
import { DarkForestEnv2 } from "@/lib/engine/env";
import { GameRng } from "@/lib/engine/rng";
import { makeTrackerHost, viewForSeat, type SeatHost } from "./tracker-host";

function quietEnv(): DarkForestEnv2 {
    const env = new DarkForestEnv2(V24_CONFIG, new GameRng([7]));
    env.reset();
    return env;
}

test("viewForSeat: reward nulled online, self/phase/end propagate", () => {
    const host: SeatHost = {
        env: quietEnv(),
        phase: "awaiting-action",
        playerSlot: 0,
        lastResult: null,
        pendingInvader: null,
        end: null,
    };
    const tracker = makeTrackerHost(host);
    const view = viewForSeat(tracker);
    expect(view.reward).toBeNull(); // 在线恒 null（用户裁决③）
    expect(view.self?.slot).toBe(0);
    expect(view.phase).toBe("awaiting-action");
    expect(view.markers[0].state).toBe("self");

    host.phase = "ended";
    host.end = { kind: "won", nAlive: 3 };
    const final = viewForSeat(tracker);
    expect(final.phase).toBe("ended");
    expect(final.end).toEqual({ kind: "won", nAlive: 3 });
    expect(final.reward).toBeNull();
});

test("queued host: ghost marker and no self until slot assigned", () => {
    const host: SeatHost = {
        env: quietEnv(),
        phase: "queued",
        playerSlot: null,
        lastResult: null,
        pendingInvader: null,
        end: null,
    };
    const view = viewForSeat(makeTrackerHost(host));
    expect(view.self).toBeNull();
    expect(view.markers).toEqual([{ id: -1, x: 50, y: 50, state: "queued" }]);
});
