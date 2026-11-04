import type { DarkForestEnv2 } from "@/lib/engine/env";
import type { TickResult } from "@/lib/engine/types";
import type { EndView, Phase, SoloMatch } from "@/lib/solo/match";
import { ViewTracker, type MatchView } from "@/lib/solo/view";
import type { OnlineView } from "./types";

/**
 * ViewTracker 的在线宿主适配器。solo/view.ts 只认 SoloMatch 形状，但其运行期
 * 消费面仅七个成员（2026-10-12 逐行核实 + 2026-11-01 v2.5 增补：phase /
 * playerSlot / env / lastResult / getPendingInvader / getPendingOriginal / getEnd）
 * ——本文件是全仓唯一的 SoloMatch 类型收口处（as unknown as SoloMatch），
 * solo 层零改动。
 *
 * getter 直读 SeatHost：驱动在 resolve 间变更 host 字段，适配器必须活引用。
 */
export interface SeatHost {
    env: DarkForestEnv2;
    phase: Phase;
    playerSlot: number | null;
    lastResult: TickResult | null;
    /** 飞行刻中的入侵者（awaiting-rechoice 时有效） */
    pendingInvader: number | null;
    end: EndView | null;
}

export function makeTrackerHost(host: SeatHost): ViewTracker {
    const adapter = {
        get env() {
            return host.env;
        },
        get phase() {
            return host.phase;
        },
        get playerSlot() {
            return host.playerSlot;
        },
        get lastResult() {
            return host.lastResult;
        },
        getPendingInvader: () => host.pendingInvader,
        // v2.5 重选视图：本刻原动作 = beginTick 锁定的 env._actions[victim]
        getPendingOriginal: (): { action: number; target: number } | null => {
            const p = host.playerSlot;
            if (p === null || host.env._actions === null) return null;
            return { action: host.env._actions[p], target: host.env._targets.get(p) ?? -1 };
        },
        getEnd: () => host.end,
    } as unknown as SoloMatch;
    return new ViewTracker(adapter);
}

/** 在线视图 = tracker.update() 后奖励置 null（用户裁决③：在线无奖励面板） */
export function viewForSeat(tracker: ViewTracker): OnlineView {
    const view: MatchView = tracker.update();
    return { ...view, reward: null };
}
