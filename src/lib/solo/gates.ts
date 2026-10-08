/**
 * 行动门理由（纯函数，自 action-grid 抽出）——给 UI 展示"为何禁用"。
 * 权威：env `valid()`（V23_CONFIG 各 gate）；parity 测试锁定 gateOf 禁用 ⊆ env 无效。
 * gateOf 只覆盖可静态解释的门（tech/已知性）；env 额外的无效化（域/风窗行、目标已死等）
 * 由会话层传入的 valid[] 表达，不在此重复。
 */
import { V23_CONFIG } from "@/lib/engine/config";
import type { MessageKey, TParams } from "@/i18n";

export type ActionId =
    | "silent"
    | "develop"
    | "broadcast"
    | "observe"
    | "domain"
    | "invade"
    | "strike"
    | "strikeWeak"
    | "strikeStrong";

export type Block = { reason: MessageKey; params?: TParams } | null;

/** env gates（config_v23）按 env 自身的检查顺序求值 */
export function gateOf(id: ActionId, tech: number, res: number, hasKnown: boolean): Block {
    switch (id) {
        case "broadcast":
            return tech > V23_CONFIG.gateBroadcastTech || res > V23_CONFIG.gateBroadcastRes
                ? null
                : { reason: "actions.disabled.broadcast" };
        case "observe":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > V23_CONFIG.gateObserveTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: V23_CONFIG.gateObserveTech } };
        case "domain":
            return tech > V23_CONFIG.gateDomainTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: V23_CONFIG.gateDomainTech } };
        case "strike":
        case "strikeWeak":
        case "strikeStrong":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > V23_CONFIG.gateStrikeTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: V23_CONFIG.gateStrikeTech } };
        case "invade":
            return hasKnown ? null : { reason: "actions.disabled.noKnown" };
        default:
            return null;
    }
}

/** ActionId → env 枚举序（0-9；本格不列 retired BOTHER） */
export const ACTION_NUM: Record<ActionId, number> = {
    silent: 0,
    develop: 1,
    broadcast: 2,
    observe: 7,
    domain: 5,
    invade: 6,
    strike: 4,
    strikeWeak: 8,
    strikeStrong: 9,
};
